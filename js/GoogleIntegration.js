
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
let driveFlushDotNetRef = null;
let driveFlushHooksRegistered = false;


window.initializeGoogleSignIn = function () {
    console.log('initializing google oidc');
    google.accounts.id.initialize({
        client_id: '6798099740-midqj6n38lhvbpg28mken7v7kvgg1al1.apps.googleusercontent.com',
        scope: DRIVE_APPDATA_SCOPE,  // TODO: Consider using drive.file scope to generate a file from the app that the user can see. Maybe using an Export option.  https://stackoverflow.com/questions/22403014/google-drive-api-scope-and-file-access-drive-vs-drive-files
        callback: handleCredentialResponse
    });

    // Do I need to do this: https://stackoverflow.com/a/71488232/84206

    google.accounts.id.renderButton(
        document.getElementById('googleSigninButton')
        , { theme: 'filled_black', type: 'standard', shape: 'rectangular', text: "signin_with", size:"large" }
    );

    google.accounts.id.renderButton(
        document.getElementById('googleSigninButton-footer')
        , { theme: 'filled_black', type: 'standard', shape: 'rectangular', text: "signin_with", size: "large" }
    );

    /*
    theme: 'outline', // "outline", "filled_blue", "filled_black"
    size: 'large', // "small", "medium", "large", changes height.  Large aligns with bootstrap navbar items
    type: 'standard', // "standard", "icon"
    shape: 'rectangular', // "rectangular", "pill"
    text: 'signin_with', // "signin_with", "signup_with", "continue_with", "signin"
    logo_alignment: 'left', // "left", "center"
    width: 250 // Any integer value representing the width in pixels
    */

    ensureTokenClientInitialized();

};

// Called when sign-in completes, we don't store the ID token because the Google library manages this
function handleCredentialResponse(response) {
    console.log("ID token received"); //: " + response.credential);
}

function ensureTokenClientInitialized()
{
    // TODO: Review hint parameter so that the access request automatically selects the already logged in user.

    if (!tokenClient)
    {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: '6798099740-midqj6n38lhvbpg28mken7v7kvgg1al1.apps.googleusercontent.com',
            // Note we will override the scope proeprty on each requestAccessToken call to request the needed scope
            scope: DRIVE_APPDATA_SCOPE,
            callback: (response) => {
                if (response.error) {
                    console.error('Error, user likely declined token/scope consent:', response.error);
                    // Handle error (e.g., user declined consent)
                } else {
                    let token = response.access_token;
                    // Store the token securely
                    console.log("tokenResponse", response);
                    // exires_in is a number of seconds, so we record a time that far in the future, but 30 seconds earlier
                    response.expiration = new Date( new Date().getTime() + ((response.expires_in - 30)*1000) );
                    console.log("New token expires at ", response.expiration.toLocaleString());
                    storeAccessTokenResponse(response);
                    //localStorage.setItem('access_token_response', response);
                    // Call the provided delegate function with the token
                    if (typeof tokenCallback === 'function') {
                        tokenCallback(token);
                    }
                    else {
                        console.error('tokenCallback is not set to a function');
                    }
                }
            }
        });
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
    if (!tokenResponse || (tokenResponse && tokenResponse.expiration < new Date().getTime()))
    {        
        console.log("Renewing token", tokenResponse?.expiration?.toLocaleString() );
        ensureTokenClientInitialized();
        //let prompt = (isFirst ? 'consent' : 'none');
        //console.log("prompt", prompt);
        tokenClient.requestAccessToken(
            overrideConfig = {
                scope: requestedScope
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
            ensureTokenClientInitialized();
            tokenClient.requestAccessToken(
                overrideConfig = {
                    scope: requestedScope
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
}

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

        const existingId = await findAppDataFileId(token, filename);
        let result;
        if (existingId)
            result = await updateAppDataFileMedia(token, existingId, bytes, mimeType, keepalive);
        else
            result = await createAppDataFile(token, filename, bytes, mimeType, keepalive);

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

        const fileId = await findAppDataFileId(token, filename);
        if (!fileId)
            return { ok: true, found: false };

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

/** Register pagehide / visibilitychange hooks that invoke DotNet FlushDirtyAsync. */
window.registerDriveFlushHooks = function (dotNetRef) {
    driveFlushDotNetRef = dotNetRef;
    if (driveFlushHooksRegistered)
        return;
    driveFlushHooksRegistered = true;

    const flush = () => {
        if (!driveFlushDotNetRef)
            return;
        try {
            driveFlushDotNetRef.invokeMethodAsync('FlushDirtyFromJs');
        } catch (e) {
            console.warn('Drive flush hook invoke failed', e);
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden')
            flush();
    });
    window.addEventListener('pagehide', flush);
};

window.unregisterDriveFlushHooks = function () {
    driveFlushDotNetRef = null;
};

/** Promise that resolves when a Drive appData access token is available (may open consent UI). */
window.ensureDriveAppDataTokenAsync = function () {
    return new Promise((resolve) => {
        if (window.hasDriveAppDataToken()) {
            resolve(true);
            return;
        }
        window.ensureAppDataFolderAccessAndAct(function (token) {
            resolve(!!token);
        });
    });
};
