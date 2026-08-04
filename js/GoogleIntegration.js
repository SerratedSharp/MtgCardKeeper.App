
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


window.initializeGoogleSignIn = function () {
    console.log('initializing google oidc');
    google.accounts.id.initialize({
        client_id: '6798099740-midqj6n38lhvbpg28mken7v7kvgg1al1.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/drive.appdata',  // TODO: Consider using drive.file scope to generate a file from the app that the user can see. Maybe using an Export option.  https://stackoverflow.com/questions/22403014/google-drive-api-scope-and-file-access-drive-vs-drive-files
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
            scope: 'https://www.googleapis.com/auth/drive.appdata',
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
    ensureHasAccessTokenForScopeAndAct('https://www.googleapis.com/auth/drive.appdata');
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
    return JSON.parse(localStorage.getItem('access_token_response'));
}


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




