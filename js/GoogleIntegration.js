
// TODO: Review best practices such as using `state` parameter https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow
// https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#examples

// TODO: Review the three different ways shown here: https://developers.google.com/identity/oauth2/web/guides/migration-to-gis#the_new_way
//          Particularly the async/await section
// also https://github.com/abacritt/angularx-social-login/blob/5276425e6dd67866079753d780e16a639628b993/projects/lib/src/providers/google-login-provider.ts#L96

// Initialize sign-in button
//document.addEventListener('DOMContentLoaded', (event) => {


//let idClient = null;
let tokenClient = null;
let tokenCallback = null;
// TODO: We can set tokenClient.callback, but we'd need to factor out the existing callback that does all the error handling and make our act'ing callback a aprameter to it

const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_ACCOUNT_SCOPES = `${DRIVE_APPDATA_SCOPE} openid email profile`;
const GOOGLE_IDENTITY_PROFILE_KEY = 'google_identity_profile';
const GOOGLE_DRIVE_PROFILE_KEY = 'google_drive_account_profile';
let driveFlushDotNetRef = null;
let driveFlushHooksRegistered = false;
let signInUiDotNetRef = null;
let pendingTokenAuthResolve = null;
let pendingTokenAuthTimeoutId = null;
let tokenClientAccountHint = null;
let driveTokenRefreshTimerId = null;
let driveTokenRefreshHooksRegistered = false;
let driveTokenRefreshArmed = false;
let driveTokenSilentRefreshInFlight = false;

/** Staged Drive upload payload for departure keepalive (immutable per revision). */
const KEEPALIVE_ELIGIBLE_MAX_BYTES = 55 * 1024;
let stagedDriveUpload = null; // { bytes:Uint8Array, revisionId, rawBytes, keepaliveEligible, filename }
let driveFileIdCache = Object.create(null); // filename -> fileId, scoped by account via clear on auth change
let departureUploadInFlightRevisionId = null;
let beforeUnloadArmed = false;

const SIGN_IN_TIMEOUT_MS = 120_000;
const DRIVE_TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;
const DRIVE_TOKEN_REFRESH_RETRY_MS = 5 * 60 * 1000;


window.initializeGoogleSignIn = function () {
    console.log('initializing Google identity and Drive authorization');
    google.accounts.id.initialize({
        client_id: '6798099740-midqj6n38lhvbpg28mken7v7kvgg1al1.apps.googleusercontent.com',
        callback: handleCredentialResponse
    });

    for (const id of ['googleSigninButton', 'googleSigninButtonFooter']) {
        const container = document.getElementById(id);
        if (!container)
            continue;
        container.replaceChildren();
        google.accounts.id.renderButton(container, {
            theme: 'filled_black',
            type: 'standard',
            shape: 'rectangular',
            text: 'signin_with',
            size: 'large'
        });
    }

    const identityProfile = getStoredGoogleIdentityProfile();
    ensureTokenClientInitialized(identityProfile?.email || null);

    // Drive authorization stays on a separate native click so Chrome preserves
    // transient user activation for the OAuth consent popup.
    for (const id of ['googleDriveConnectButton', 'googleDriveConnectButtonFooter']) {
        const button = document.getElementById(id);
        if (!button)
            continue;

        button.onclick = function () {
            console.log('Google Drive connect clicked; requesting token with user activation');
            button.disabled = true;
            window.ensureDriveAppDataTokenAsync(false)
                .then((result) => {
                    console.log('Google Drive connect completed', result);
                })
                .catch((error) => {
                    console.error('Google Drive authorization failed', error);
                    notifySignInUi('error', userMessageForAuthError(error?.message));
                })
                .finally(() => {
                    button.disabled = false;
                });
        };
    }
};

function handleCredentialResponse(response) {
    const identityProfile = decodeGoogleIdentityProfile(response?.credential);
    if (!identityProfile) {
        console.error('Google identity response did not contain a readable profile');
        notifySignInUi('error', 'Could not read the selected Google account.', null);
        return;
    }

    console.log('Google identity selected', {
        email: identityProfile.email,
        name: identityProfile.name
    });
    localStorage.setItem(GOOGLE_IDENTITY_PROFILE_KEY, JSON.stringify(identityProfile));

    tokenClient = null;
    tokenClientAccountHint = null;
    ensureTokenClientInitialized(identityProfile.email || null);

    const driveProfile = getStoredGoogleDriveProfile();
    const sameDriveAccount = window.hasDriveAppDataToken()
        && profilesRepresentSameAccount(identityProfile, driveProfile);
    const accountLabel = identityProfile.email || identityProfile.name || null;

    if (sameDriveAccount) {
        notifySignInUi(
            'success',
            `Signed in as ${accountLabel}. Google Drive sync is ready.`,
            accountLabel);
        return;
    }

    clearStoredDriveAuthorization();
    notifySignInUi(
        'identity',
        `Signed in as ${accountLabel}. Connect this account to Google Drive.`,
        accountLabel);
}

function notifySignInUi(phase, message, accountLabel) {
    if (!signInUiDotNetRef) {
        console.warn('Google sign-in UI callback is not registered', phase, message, accountLabel);
        return;
    }
    console.log('Notifying Google sign-in UI', phase, message || '', accountLabel || '');
    signInUiDotNetRef
        .invokeMethodAsync(
            'OnGoogleSignInStatusChanged',
            phase,
            message || '',
            accountLabel || null)
        .catch((error) => console.warn('notifySignInUi failed', error));
}

function clearPendingTokenAuthTimeout() {
    if (pendingTokenAuthTimeoutId != null) {
        clearTimeout(pendingTokenAuthTimeoutId);
        pendingTokenAuthTimeoutId = null;
    }
}

function resolvePendingTokenAuth(ok, error) {
    clearPendingTokenAuthTimeout();
    if (!pendingTokenAuthResolve)
        return false;
    const resolve = pendingTokenAuthResolve;
    pendingTokenAuthResolve = null;
    console.log('Resolving pending Google Drive authorization', { ok: !!ok, error: error || null });
    resolve({ ok: !!ok, error: ok ? null : (error || 'no_token') });
    return true;
}

function userMessageForAuthError(error) {
    switch (error) {
        case 'access_denied':
            return 'Google Drive permission was declined. Try again and allow access to save your collection.';
        case 'popup_blocked':
            return 'Sign-in popup was blocked. Allow popups for this site and try again.';
        case 'timeout':
            return 'Sign-in timed out. Please try again.';
        case 'no_token':
        case 'consent_denied':
            return 'Could not get Google Drive access. You may have closed the consent dialog.';
        default:
            return error
                ? `Google sign-in failed (${error}). Try again from Manage Data.`
                : 'Google sign-in failed. Try again from Manage Data.';
    }
}

function isTokenExpired(tokenResponse) {
    if (!tokenResponse?.expiration)
        return true;
    const expiresAt = new Date(tokenResponse.expiration).getTime();
    return Number.isNaN(expiresAt) || expiresAt < Date.now();
}

function clearDriveTokenRefreshTimer() {
    if (driveTokenRefreshTimerId != null) {
        clearTimeout(driveTokenRefreshTimerId);
        driveTokenRefreshTimerId = null;
    }
}

function armDriveTokenRefresh(reason) {
    if (!getStoredGoogleIdentityProfile() || !getAccessTokenResponse())
        return;

    driveTokenRefreshArmed = true;
    console.log(
        'Google Drive token refresh armed; waiting for next user gesture',
        { reason });
}

function scheduleDriveTokenRefresh() {
    clearDriveTokenRefreshTimer();
    driveTokenRefreshArmed = false;

    const tokenResponse = getAccessTokenResponse();
    if (!tokenResponse?.access_token || !getStoredGoogleIdentityProfile())
        return;

    const expiresAt = new Date(tokenResponse.expiration).getTime();
    if (!Number.isFinite(expiresAt)) {
        armDriveTokenRefresh('missing_expiration');
        return;
    }

    const refreshAt = expiresAt - DRIVE_TOKEN_REFRESH_LEAD_MS;
    const delayMs = refreshAt - Date.now();
    if (delayMs <= 0) {
        armDriveTokenRefresh('near_or_past_expiration');
        return;
    }

    driveTokenRefreshTimerId = setTimeout(
        () => armDriveTokenRefresh('scheduled_before_expiration'),
        delayMs);
    console.log(
        'Google Drive token refresh scheduled',
        {
            refreshAt: new Date(refreshAt).toLocaleString(),
            expiresAt: new Date(expiresAt).toLocaleString()
        });
}

function scheduleDriveTokenRefreshRetry(reason) {
    clearDriveTokenRefreshTimer();
    driveTokenRefreshArmed = false;
    driveTokenRefreshTimerId = setTimeout(
        () => armDriveTokenRefresh(`retry_after_${reason}`),
        DRIVE_TOKEN_REFRESH_RETRY_MS);
    console.warn(
        'Silent Google Drive token refresh deferred until a later user gesture',
        { reason });
}

function isGoogleAuthorizationControl(target) {
    return target instanceof Element
        && target.closest(
            '#googleSigninButton, #googleSigninButtonFooter, '
            + '#googleDriveConnectButton, #googleDriveConnectButtonFooter') != null;
}

function trySilentDriveTokenRefreshFromGesture(event) {
    if (!event.isTrusted
        || !driveTokenRefreshArmed
        || driveTokenSilentRefreshInFlight
        || pendingTokenAuthResolve
        || typeof tokenCallback === 'function'
        || isGoogleAuthorizationControl(event.target))
        return;

    if (!window.google?.accounts?.oauth2) {
        console.warn('Google Identity Services is not ready for token refresh');
        return;
    }

    driveTokenRefreshArmed = false;
    driveTokenSilentRefreshInFlight = true;
    ensureTokenClientInitialized(getStoredGoogleIdentityProfile()?.email || null);
    console.log('Requesting silent Google Drive token refresh from user gesture');
    tokenClient.requestAccessToken({
        scope: GOOGLE_ACCOUNT_SCOPES,
        prompt: ''
    });
}

window.getOrCreateSyncDeviceName = function () {
    const key = 'mtg_sync_device_name';
    try {
        const existing = localStorage.getItem(key);
        if (existing && existing.trim())
            return existing.trim();
    } catch {
        // ignore
    }

    let label = 'Browser';
    try {
        const ua = navigator.userAgent || '';
        if (/Edg\//i.test(ua))
            label = 'Edge';
        else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua))
            label = 'Chrome';
        else if (/Firefox\//i.test(ua))
            label = 'Firefox';
        else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua))
            label = 'Safari';

        if (/Android/i.test(ua))
            label += ' on Android';
        else if (/iPhone|iPad|iPod/i.test(ua))
            label += ' on iOS';
        else if (/Windows/i.test(ua))
            label += ' on Windows';
        else if (/Mac OS X/i.test(ua))
            label += ' on Mac';
        else if (/Linux/i.test(ua))
            label += ' on Linux';
    } catch {
        // ignore
    }

    try {
        localStorage.setItem(key, label);
    } catch {
        // ignore
    }
    return label;
};

window.initializeGoogleDriveTokenRefresh = function () {
    if (!driveTokenRefreshHooksRegistered) {
        document.addEventListener(
            'click',
            trySilentDriveTokenRefreshFromGesture,
            { capture: true });
        document.addEventListener(
            'keydown',
            trySilentDriveTokenRefreshFromGesture,
            { capture: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible')
                scheduleDriveTokenRefresh();
        });
        driveTokenRefreshHooksRegistered = true;
    }

    scheduleDriveTokenRefresh();
};

function ensureTokenClientInitialized(accountHint)
{
    const normalizedHint = accountHint || null;
    if (!tokenClient || tokenClientAccountHint !== normalizedHint)
    {
        const config = {
            client_id: '6798099740-midqj6n38lhvbpg28mken7v7kvgg1al1.apps.googleusercontent.com',
            // Note we will override the scope proeprty on each requestAccessToken call to request the needed scope
            scope: GOOGLE_ACCOUNT_SCOPES,
            error_callback: (error) => {
                const errorCode = error?.type === 'popup_failed_to_open'
                    ? 'popup_blocked'
                    : (error?.type || 'unknown');
                if (driveTokenSilentRefreshInFlight) {
                    driveTokenSilentRefreshInFlight = false;
                    scheduleDriveTokenRefreshRetry(errorCode);
                    return;
                }

                console.error('Google token popup error:', errorCode, error);
                resolvePendingTokenAuth(false, errorCode);
                notifySignInUi('error', userMessageForAuthError(errorCode));
                if (typeof tokenCallback === 'function') {
                    const callback = tokenCallback;
                    tokenCallback = null;
                    callback(null);
                }
            },
            callback: async (response) => {
                if (response.error) {
                    if (driveTokenSilentRefreshInFlight) {
                        driveTokenSilentRefreshInFlight = false;
                        scheduleDriveTokenRefreshRetry(response.error);
                        return;
                    }

                    console.error('Error, user likely declined token/scope consent:', response.error);
                    const resolved = resolvePendingTokenAuth(false, response.error);
                    if (resolved) {
                        notifySignInUi('error', userMessageForAuthError(response.error));
                    }
                    if (typeof tokenCallback === 'function') {
                        const callback = tokenCallback;
                        tokenCallback = null;
                        callback(null);
                    }
                } else {
                    const wasSilentRefresh = driveTokenSilentRefreshInFlight;
                    driveTokenSilentRefreshInFlight = false;
                    let token = response.access_token;
                    // Store the token securely
                    console.log("tokenResponse", response);
                    // exires_in is a number of seconds, so we record a time that far in the future, but 30 seconds earlier
                    response.expiration = new Date( new Date().getTime() + ((response.expires_in - 30)*1000) );
                    console.log("New token expires at ", response.expiration.toLocaleString());
                    storeAccessTokenResponse(response);
                    const accountLabel = await fetchAndStoreGoogleDriveProfile(token);
                    if (wasSilentRefresh) {
                        console.log(
                            'Silent Google Drive token refresh succeeded',
                            { accountLabel, expiresAt: response.expiration });
                        if (signInUiDotNetRef) {
                            notifySignInUi(
                                'success',
                                accountLabel
                                    ? `Signed in as ${accountLabel}. Google Drive sync is ready.`
                                    : 'Signed in. Google Drive sync is ready.',
                                accountLabel);
                        }
                    }
                    const resolved = resolvePendingTokenAuth(true, null);
                    if (resolved) {
                        notifySignInUi(
                            'success',
                            accountLabel
                                ? `Signed in as ${accountLabel}. Google Drive sync is ready.`
                                : 'Signed in. Google Drive sync is ready.',
                            accountLabel);
                    }
                    //localStorage.setItem('access_token_response', response);
                    // Call the provided delegate function with the token
                    if (typeof tokenCallback === 'function') {
                        const callback = tokenCallback;
                        tokenCallback = null;
                        callback(token);
                    }
                    else if (!resolved) {
                        console.log('Token stored with no pending authorization callback');
                    }
                }
            }
        };
        if (normalizedHint)
            config.hint = normalizedHint;

        tokenClient = google.accounts.oauth2.initTokenClient(config);
        tokenClientAccountHint = normalizedHint;
    }
}

// Ensures has token for scope, and then calls the tokenCallback.  Caller should set tokenCallback before calling this function.
// This funciton is non-blocking, so caller should have all followup code in the handler for the tokenCallback.
function ensureHasAccessTokenForScopeAndAct(requestedScope, clearExistingToken) {
    //if (clearExistingToken)
    //    localStorage.removeItem('access_token');

    // Review usse of gapi to manage token: https://developers.google.com/people/quickstart/js
    // https://github.com/googleworkspace/browser-samples/blob/main/classroom/quickstart/index.html

    let tokenResponse = getAccessTokenResponse();//localStorage.getItem('access_token_response');
    
    //token = null;
    // TODO: Verify token contains the desired scope.  Right now we just check if the token exists, not necesarily it has requested scope.

    // if no token stored, or the stored token is expired
    if (!tokenResponse || isTokenExpired(tokenResponse))
    {        
        console.log("Renewing token", tokenResponse?.expiration?.toLocaleString() );
        ensureTokenClientInitialized(getStoredGoogleIdentityProfile()?.email || null);
        //let prompt = (isFirst ? 'consent' : 'none');
        //console.log("prompt", prompt);
        tokenClient.requestAccessToken(
            overrideConfig = {
                scope: GOOGLE_ACCOUNT_SCOPES
                //, prompt: 'none' // TODO: None allows a simplifer popup to flash.  Test whether this works on the first time someone logs in and has never consented. 
            }
        );
    }
    else {
        // has token stored, attempt action
        let token = tokenResponse.access_token;
        // We have the desired token, so just call the callback
        console.log("Calling callback with tokenresponse", tokenResponse);
        try {
            tokenCallback(token);
        }
        catch (error) {
            console.log("Error in tokenCallback using pre-existing token", error);
            // try to get a fresh token
            ensureTokenClientInitialized(getStoredGoogleIdentityProfile()?.email || null);
            tokenClient.requestAccessToken(
                overrideConfig = {
                    scope: GOOGLE_ACCOUNT_SCOPES
                    //, prompt: 'none' // TODO: None allows a simplifer popup to flash.  Test whether this works on the first time someone logs in and has never consented. 
                }
            );
            // if this requestAccessToken succeeds, it will call the tokenCallback via the response callback handler

        }
    }

}

// Request access to the app data folder,
// then calls the onAccessTokenCallback delegate to perform the desired Google API action with that access
window.ensureAppDataFolderAccessAndAct = function (onAccessTokenCallback)
{
    tokenCallback = onAccessTokenCallback;
    ensureHasAccessTokenForScopeAndAct(DRIVE_APPDATA_SCOPE);
}


// TODO: Make this async?
window.saveToAppDataFolder = function (filename, content)
{
    let filenameLocal = filename;
    let contentLocal = content;

    let saveToAppDataFolderCallback = function (token) {
        internalSaveToAppDataFolder(token, filename, content);         
    }

    window.ensureAppDataFolderAccessAndAct(saveToAppDataFolderCallback);

}


function storeAccessTokenResponse(response) {
    localStorage.setItem('access_token_response', JSON.stringify(response));
    scheduleDriveTokenRefresh();
}

function readStoredProfile(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw)
            return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function getStoredGoogleIdentityProfile() {
    return readStoredProfile(GOOGLE_IDENTITY_PROFILE_KEY);
}

function getStoredGoogleDriveProfile() {
    return readStoredProfile(GOOGLE_DRIVE_PROFILE_KEY)
        ?? readStoredProfile('google_account_profile');
}

function getProfileLabel(profile) {
    return profile?.email || profile?.name || null;
}

function decodeGoogleIdentityProfile(credential) {
    try {
        if (!credential)
            return null;
        const payloadBase64 = credential.split('.')[1]
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        const padded = payloadBase64.padEnd(
            payloadBase64.length + ((4 - payloadBase64.length % 4) % 4),
            '=');
        const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        return {
            sub: payload.sub || null,
            email: payload.email || null,
            name: payload.name || null
        };
    } catch (error) {
        console.warn('Could not decode Google identity credential', error);
        return null;
    }
}

function profilesRepresentSameAccount(left, right) {
    if (!left || !right)
        return false;
    if (left.sub && right.sub)
        return left.sub === right.sub;
    if (left.email && right.email)
        return left.email.toLowerCase() === right.email.toLowerCase();
    return false;
}

function clearStoredDriveAuthorization() {
    clearDriveTokenRefreshTimer();
    driveTokenRefreshArmed = false;
    driveTokenSilentRefreshInFlight = false;
    localStorage.removeItem('access_token_response');
    localStorage.removeItem(GOOGLE_DRIVE_PROFILE_KEY);
    localStorage.removeItem('google_account_profile');
    driveFileIdCache = Object.create(null);
    stagedDriveUpload = null;
    departureUploadInFlightRevisionId = null;
    beforeUnloadArmed = false;
}

async function fetchAndStoreGoogleDriveProfile(token) {
    try {
        const response = await fetch(
            'https://openidconnect.googleapis.com/v1/userinfo',
            { headers: { 'Authorization': 'Bearer ' + token } });
        if (!response.ok) {
            console.warn('Could not load Google account profile', response.status);
            return getProfileLabel(getStoredGoogleDriveProfile());
        }

        const profile = await response.json();
        const storedProfile = {
            sub: profile.sub || null,
            email: profile.email || null,
            name: profile.name || null
        };
        localStorage.setItem(GOOGLE_DRIVE_PROFILE_KEY, JSON.stringify(storedProfile));
        return getProfileLabel(storedProfile);
    } catch (error) {
        console.warn('Could not load Google account profile', error);
        return getProfileLabel(getStoredGoogleDriveProfile());
    }
}

window.getGoogleDriveAccountLabel = function () {
    return getProfileLabel(getStoredGoogleDriveProfile());
};

window.getGoogleIdentityAccountLabel = function () {
    return getProfileLabel(getStoredGoogleIdentityProfile());
};

function getAccessTokenResponse() {
    try {
        const raw = localStorage.getItem('access_token_response');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/** Soft auth: cached token present, not expired, and scope includes drive.appdata when listed. */
window.hasDriveAppDataToken = function () {
    const tokenResponse = getAccessTokenResponse();
    if (!tokenResponse || !tokenResponse.access_token)
        return false;

    const expiration = tokenResponse.expiration;
    if (expiration != null && new Date(expiration).getTime() < Date.now())
        return false;

    const scope = tokenResponse.scope;
    if (typeof scope === 'string' && scope.length > 0
        && !scope.includes('drive.appdata')
        && !scope.includes(DRIVE_APPDATA_SCOPE))
        return false;

    return true;
};

window.getDriveAppDataAccessToken = function () {
    if (!window.hasDriveAppDataToken())
        return null;
    return getAccessTokenResponse()?.access_token ?? null;
};

async function findAppDataFileId(token, filename) {
    const q = encodeURIComponent(`name='${filename.replace(/'/g, "\\'")}'`);
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name)&pageSize=10`;
    const response = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + token }
    });
    if (response.status === 401 || response.status === 403) {
        const err = new Error('Drive auth failed: ' + response.status);
        err.status = response.status;
        throw err;
    }
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`findAppDataFileId failed ${response.status}: ${body}`);
    }
    const data = await response.json();
    const files = data.files || [];
    return files.length > 0 ? files[0].id : null;
}

async function downloadAppDataFileBytes(token, fileId) {
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { 'Authorization': 'Bearer ' + token } });
    if (response.status === 401 || response.status === 403) {
        const err = new Error('Drive auth failed: ' + response.status);
        err.status = response.status;
        throw err;
    }
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`download failed ${response.status}: ${body}`);
    }
    const buf = await response.arrayBuffer();
    return new Uint8Array(buf);
}

async function createAppDataFile(token, filename, bytes, mimeType, keepalive) {
    const metadata = { name: filename, parents: ['appDataFolder'] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([bytes], { type: mimeType || 'application/octet-stream' }));

    const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: form,
            keepalive: !!keepalive
        });

    if (response.status === 401 || response.status === 403) {
        const err = new Error('Drive auth failed: ' + response.status);
        err.status = response.status;
        throw err;
    }
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`create failed ${response.status}: ${body}`);
    }
    return await response.json();
}

async function updateAppDataFileMedia(token, fileId, bytes, mimeType, keepalive) {
    const response = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': mimeType || 'application/octet-stream'
            },
            body: bytes,
            keepalive: !!keepalive
        });

    if (response.status === 401 || response.status === 403) {
        const err = new Error('Drive auth failed: ' + response.status);
        err.status = response.status;
        throw err;
    }
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`update failed ${response.status}: ${body}`);
    }
    return await response.json();
}

/**
 * Upsert a file in appDataFolder by name.
 * @param {string} filename
 * @param {Uint8Array|number[]|string} content - bytes or UTF-8 string
 * @param {string} [mimeType]
 * @param {boolean} [keepalive]
 * @returns {Promise<{ok:boolean, fileId?:string, status?:number, error?:string}>}
 */
window.upsertAppDataFile = async function (filename, content, mimeType, keepalive) {
    try {
        const token = window.getDriveAppDataAccessToken();
        if (!token)
            return { ok: false, status: 401, error: 'no_token' };

        let bytes;
        if (typeof content === 'string')
            bytes = new TextEncoder().encode(content);
        else if (content instanceof Uint8Array)
            bytes = content;
        else if (Array.isArray(content) || ArrayBuffer.isView(content))
            bytes = new Uint8Array(content);
        else
            return { ok: false, error: 'unsupported_content' };

        let existingId = driveFileIdCache[filename] || await findAppDataFileId(token, filename);
        let result;
        if (existingId) {
            result = await updateAppDataFileMedia(token, existingId, bytes, mimeType, keepalive);
            driveFileIdCache[filename] = existingId;
        } else {
            result = await createAppDataFile(token, filename, bytes, mimeType, keepalive);
            if (result?.id)
                driveFileIdCache[filename] = result.id;
        }

        return { ok: true, fileId: result.id || existingId };
    } catch (e) {
        console.error('upsertAppDataFile', e);
        return {
            ok: false,
            status: e.status || 0,
            error: e.message || String(e)
        };
    }
};

async function deleteAppDataFileById(token, fileId) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
    });
    if (response.status === 401 || response.status === 403) {
        const err = new Error('Drive auth failed: ' + response.status);
        err.status = response.status;
        throw err;
    }
    if (!response.ok && response.status !== 404) {
        const body = await response.text();
        throw new Error(`delete failed ${response.status}: ${body}`);
    }
}

/**
 * Deletes every file in the Drive appDataFolder for this app.
 * @returns {Promise<{ok:boolean, deletedCount?:number, status?:number, error?:string}>}
 */
window.deleteAllAppDataFiles = async function () {
    try {
        const token = window.getDriveAppDataAccessToken();
        if (!token)
            return { ok: false, status: 401, error: 'no_token' };

        const listUrl = 'https://www.googleapis.com/drive/v3/files'
            + '?spaces=appDataFolder&fields=files(id,name)&pageSize=100';
        const listResp = await fetch(listUrl, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (listResp.status === 401 || listResp.status === 403) {
            const err = new Error('Drive auth failed: ' + listResp.status);
            err.status = listResp.status;
            throw err;
        }
        if (!listResp.ok) {
            const body = await listResp.text();
            throw new Error(`list appData failed ${listResp.status}: ${body}`);
        }

        const data = await listResp.json();
        const files = data.files || [];
        for (const file of files) {
            if (file?.id)
                await deleteAppDataFileById(token, file.id);
        }

        return { ok: true, deletedCount: files.length };
    } catch (e) {
        console.error('deleteAllAppDataFiles', e);
        return {
            ok: false,
            status: e.status || 0,
            error: e.message || String(e)
        };
    } finally {
        driveFileIdCache = Object.create(null);
        stagedDriveUpload = null;
        departureUploadInFlightRevisionId = null;
    }
};

/** Encode Uint8Array as base64 (chunked — apply/spread blows up on large files). */
function uint8ToBase64(u8) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < u8.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

/**
 * Download an appData file by name.
 * Bytes are returned as base64 so Blazor can deserialize a nested DTO without
 * the JSInterop byte[] revival protocol (nested Uint8Array/number[] fails).
 * @returns {Promise<{ok:boolean, found?:boolean, contentBase64?:string, status?:number, error?:string}>}
 */
window.downloadAppDataFile = async function (filename) {
    try {
        const token = window.getDriveAppDataAccessToken();
        if (!token)
            return { ok: false, status: 401, error: 'no_token' };

        let fileId = driveFileIdCache[filename] || await findAppDataFileId(token, filename);
        if (!fileId)
            return { ok: true, found: false };

        driveFileIdCache[filename] = fileId;
        const bytes = await downloadAppDataFileBytes(token, fileId);
        return { ok: true, found: true, contentBase64: uint8ToBase64(bytes) };
    } catch (e) {
        console.error('downloadAppDataFile', e);
        return {
            ok: false,
            status: e.status || 0,
            error: e.message || String(e)
        };
    }
};

async function internalSaveToAppDataFolder (token, filename, content, retryNumber)
{
    console.log("token", token);

    let fileContent = content;
    let file = new Blob([fileContent], { type: 'text/plain' });
    let metadata = {
        name: filename,
        parents: ['appDataFolder']
    };

    let form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);


    try {
        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: new Headers({ 'Authorization': 'Bearer ' + token }),
            body: form
        });

        if (response.ok) {
            try {
                const data = await response.json();
                console.log('File ID:', data.id);
                //return data;
            }
            catch (error) {
                console.error('Error in .json():', error);
            }
        }
        else {
            console.error('Non-OK/200 response failure:', response);
            const responseBody = await response.text();
            console.log('Failed Response Body:', responseBody);
        }
        
    } catch (error) {
        console.error('Fetch error:', error);
    }


}

/**
 * Stage gzip inventory bytes in JS memory for debounce + departure uploads.
 * @returns {{ok:boolean, keepaliveEligible:boolean, hasCachedFileId:boolean, gzipBytes:number, error?:string}}
 */
window.stageDriveUploadPayload = function (gzipBytes, revisionId, rawBytes, keepaliveEligible, filename) {
    try {
        let bytes;
        if (gzipBytes instanceof Uint8Array)
            bytes = gzipBytes;
        else if (Array.isArray(gzipBytes) || ArrayBuffer.isView(gzipBytes))
            bytes = new Uint8Array(gzipBytes);
        else
            return { ok: false, keepaliveEligible: false, hasCachedFileId: false, gzipBytes: 0, error: 'unsupported_content' };

        const hasCachedFileId = !!(filename && driveFileIdCache[filename]);
        let eligible = !!keepaliveEligible
            && bytes.length > 0
            && bytes.length <= KEEPALIVE_ELIGIBLE_MAX_BYTES
            && !!window.getDriveAppDataAccessToken()
            && hasCachedFileId;

        stagedDriveUpload = {
            bytes,
            revisionId: revisionId || null,
            rawBytes: rawBytes || 0,
            keepaliveEligible: eligible,
            filename: filename || 'UserInventories.mempack'
        };

        console.log(
            `stageDriveUploadPayload revision=${revisionId} gzip=${bytes.length} ` +
            `eligible=${eligible} cachedFileId=${hasCachedFileId}`);

        return {
            ok: true,
            keepaliveEligible: eligible,
            hasCachedFileId,
            gzipBytes: bytes.length
        };
    } catch (e) {
        console.warn('stageDriveUploadPayload failed', e);
        stagedDriveUpload = null;
        return {
            ok: false,
            keepaliveEligible: false,
            hasCachedFileId: false,
            gzipBytes: 0,
            error: e.message || String(e)
        };
    }
};

window.clearStagedDriveUploadPayload = function () {
    stagedDriveUpload = null;
    departureUploadInFlightRevisionId = null;
};

window.getStagedDriveUploadPayload = function () {
    if (!stagedDriveUpload?.bytes?.length)
        return { ok: false, contentBase64: null, revisionId: null, keepaliveEligible: false, gzipBytes: 0 };

    return {
        ok: true,
        contentBase64: uint8ToBase64(stagedDriveUpload.bytes),
        revisionId: stagedDriveUpload.revisionId,
        keepaliveEligible: !!stagedDriveUpload.keepaliveEligible,
        gzipBytes: stagedDriveUpload.bytes.length
    };
};

window.setBeforeUnloadArmed = function (armed) {
    beforeUnloadArmed = !!armed;
};

/**
 * Direct keepalive media PATCH using staged bytes + cached file id only.
 * Mutually exclusive with oversized beforeunload path.
 */
window.tryKeepaliveStagedInventoryUpload = async function (trigger) {
    const staged = stagedDriveUpload;
    if (!staged?.bytes?.length || !staged.revisionId)
        return { ok: false, error: 'no_staged_payload' };

    if (!staged.keepaliveEligible || staged.bytes.length > KEEPALIVE_ELIGIBLE_MAX_BYTES)
        return { ok: false, error: 'not_eligible' };

    if (departureUploadInFlightRevisionId === staged.revisionId) {
        console.log(`tryKeepaliveStagedInventoryUpload coalesce revision=${staged.revisionId} trigger=${trigger}`);
        return { ok: true, fileId: driveFileIdCache[staged.filename], coalesced: true };
    }

    const token = window.getDriveAppDataAccessToken();
    const fileId = driveFileIdCache[staged.filename];
    if (!token || !fileId)
        return { ok: false, status: token ? 0 : 401, error: token ? 'no_cached_file_id' : 'no_token' };

    departureUploadInFlightRevisionId = staged.revisionId;
    console.log(
        `tryKeepaliveStagedInventoryUpload start revision=${staged.revisionId} ` +
        `bytes=${staged.bytes.length} trigger=${trigger}`);

    try {
        await updateAppDataFileMedia(token, fileId, staged.bytes, 'application/gzip', true);
        console.log(`tryKeepaliveStagedInventoryUpload ok revision=${staged.revisionId}`);

        if (driveFlushDotNetRef) {
            try {
                driveFlushDotNetRef.invokeMethodAsync('OnKeepaliveUploadSucceeded', staged.revisionId);
            } catch (e) {
                console.warn('OnKeepaliveUploadSucceeded invoke failed', e);
            }
        }

        return { ok: true, fileId };
    } catch (e) {
        console.error('tryKeepaliveStagedInventoryUpload failed', e);
        departureUploadInFlightRevisionId = null;
        return {
            ok: false,
            status: e.status || 0,
            error: e.message || String(e)
        };
    }
};

/** Register visibility / pagehide / beforeunload hooks for size-aware Drive flush. */
window.registerDriveFlushHooks = function (dotNetRef) {
    driveFlushDotNetRef = dotNetRef;
    if (driveFlushHooksRegistered)
        return;
    driveFlushHooksRegistered = true;

    const onHidden = () => {
        if (document.visibilityState !== 'hidden')
            return;
        // Small eligible only — mutually exclusive with beforeunload large path.
        if (stagedDriveUpload?.keepaliveEligible)
            window.tryKeepaliveStagedInventoryUpload('visibilitychange');
    };

    const onPageHide = () => {
        if (stagedDriveUpload?.keepaliveEligible)
            window.tryKeepaliveStagedInventoryUpload('pagehide');
    };

    const onBeforeUnload = (event) => {
        if (!beforeUnloadArmed)
            return;
        if (stagedDriveUpload?.keepaliveEligible)
            return;

        // Oversized / ineligible: ask C# to start normal upload + show browser warning.
        if (driveFlushDotNetRef) {
            try {
                driveFlushDotNetRef.invokeMethodAsync('FlushDirtyFromJs', 'beforeunload');
                driveFlushDotNetRef.invokeMethodAsync('OnDepartureStayRequested');
            } catch (e) {
                console.warn('beforeunload flush invoke failed', e);
            }
        }

        event.preventDefault();
        event.returnValue = '';
    };

    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
};

window.unregisterDriveFlushHooks = function () {
    driveFlushDotNetRef = null;
    beforeUnloadArmed = false;
};

window.registerGoogleSignInUiCallback = function (dotNetRef) {
    signInUiDotNetRef = dotNetRef;
};

window.unregisterGoogleSignInUiCallback = function () {
    signInUiDotNetRef = null;
};

/** Promise that resolves when a Drive appData access token is available (may open consent UI). */
window.ensureDriveAppDataTokenAsync = function (forceAccountPicker) {
    return new Promise((resolve) => {
        if (!forceAccountPicker && window.hasDriveAppDataToken()) {
            const accountLabel = getProfileLabel(getStoredGoogleDriveProfile());
            console.log('Existing Google Drive token is still valid');
            notifySignInUi(
                'success',
                accountLabel
                    ? `Signed in as ${accountLabel}. Google Drive sync is ready.`
                    : 'Signed in. Google Drive sync is ready.',
                accountLabel);
            resolve({ ok: true, error: null });
            return;
        }

        if (pendingTokenAuthResolve) {
            resolve({ ok: false, error: 'sign_in_in_progress' });
            return;
        }

        pendingTokenAuthResolve = resolve;
        pendingTokenAuthTimeoutId = setTimeout(() => {
            if (!pendingTokenAuthResolve)
                return;
            resolvePendingTokenAuth(false, 'timeout');
            notifySignInUi('error', userMessageForAuthError('timeout'));
        }, SIGN_IN_TIMEOUT_MS);

        notifySignInUi('progress', 'Waiting for Google sign-in…');
        const onToken = function (token) {
            const resolved = resolvePendingTokenAuth(!!token, token ? null : 'no_token');
            if (!resolved)
                return;
            if (!token) {
                notifySignInUi('error', userMessageForAuthError('no_token'));
            } else {
                const accountLabel = getProfileLabel(getStoredGoogleDriveProfile());
                notifySignInUi(
                    'success',
                    accountLabel
                        ? `Signed in as ${accountLabel}. Google Drive sync is ready.`
                        : 'Signed in. Google Drive sync is ready.',
                    accountLabel);
            }
        };

        if (forceAccountPicker) {
            console.log('Opening Google account picker');
            tokenCallback = onToken;
            ensureTokenClientInitialized(getStoredGoogleIdentityProfile()?.email || null);
            tokenClient.requestAccessToken({
                scope: GOOGLE_ACCOUNT_SCOPES,
                prompt: 'select_account'
            });
        } else {
            window.ensureAppDataFolderAccessAndAct(onToken);
        }
    });
};
