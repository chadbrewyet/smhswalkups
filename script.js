// TOP OF FILE: Ensure these are exactly as shown
const CLIENT_ID = 'e299f9731add487cb32f1c4e3989c847'; 
const REDIRECT_URI = 'https://chadbrewyet.github.io/smhswalkups/'; 
const SCOPES = ['streaming', 'user-read-playback-state', 'user-modify-playback-state'];

// UPDATED LOGIN FUNCTION
function loginToSpotify() {
    const baseUrl = "https://accounts.spotify.com/authorize";
    
    // Using URLSearchParams is the safest way to ensure no typos in the string
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'token',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES.join(' '),
        show_dialog: 'true' // Forces the login window to show for testing
    });

    const finalUrl = `${baseUrl}?${params.toString()}`;
    
    // LOG FOR DEBUGGING (Open your browser console with F12 to see this)
    console.log("Redirecting to:", finalUrl);
    
    window.location.href = finalUrl;
}

// UPDATED AUTH HANDLER
function handleAuth() {
    // Check if we have a token or an error in the URL
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    
    const accessToken = params.get('access_token');
    const error = params.get('error');

    if (accessToken) {
        access_token = accessToken;
        // Clean the URL hash
        window.history.replaceState(null, null, window.location.pathname);
        
        initSpotifyPlayer();
        document.getElementById('auth-status').textContent = "(Connected)";
        document.getElementById('auth-status').style.color = "#1DB954";
        document.getElementById('spotify-login-btn').style.display = "none";
    } else if (error) {
        console.error("Spotify Auth Error:", error);
        alert("Spotify returned an error: " + error);
    }
}

