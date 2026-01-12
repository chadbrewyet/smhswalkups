const CLIENT_ID = 'e299f9731add487cb32f1c4e3989c847'; 
const REDIRECT_URI = 'https://chadbrewyet.github.io/smhswalkups/'; 
const SCOPES = 'streaming user-read-playback-state user-modify-playback-state';

let db, player, device_id, access_token;
let currentBtn = null;
let isLocked = true;
let lastPlayedIndex = -2;
let globalVolume = 80; 
let fadeInterval = null;

// INITIALIZATION
function initDatabase() {
    const request = indexedDB.open("BaseballSpotifyDB", 1);
    request.onupgradeneeded = (e) => {
        db = e.target.result;
        db.createObjectStore("players", { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = (e) => {
        db = e.target.result;
        handleAuth();
        refreshRosterUI();
        loadLineupState();
    };
}

// THE FIX: Manual URL Construction
function loginToSpotify() {
    // We construct the URL manually to ensure 'response_type=token' is exactly what Spotify expects
    let url = 'https://accounts.spotify.com/authorize';
    url += '?client_id=' + encodeURIComponent(CLIENT_ID);
    url += '&response_type=token';
    url += '&redirect_uri=' + encodeURIComponent(REDIRECT_URI);
    url += '&scope=' + encodeURIComponent(SCOPES);
    url += '&show_dialog=true';

    window.location.href = url;
}

function handleAuth() {
    const hash = window.location.hash.substring(1);
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const error = params.get('error');

    if (accessToken) {
        access_token = accessToken;
        window.history.replaceState(null, null, window.location.pathname);
        initSpotifyPlayer();
        
        const statusEl = document.getElementById('auth-status');
        if(statusEl) {
            statusEl.textContent = "(Connected)";
            statusEl.style.color = "#1DB954";
        }
        const loginBtn = document.getElementById('spotify-login-btn');
        if(loginBtn) loginBtn.style.display = "none";
    } else if (error) {
        alert("Spotify Error: " + error);
    }
}

function initSpotifyPlayer() {
    window.onSpotifyWebPlaybackSDKReady = () => {
        player = new Spotify.Player({
            name: 'SMHS Baseball Soundboard',
            getOAuthToken: cb => { cb(access_token); },
            volume: globalVolume / 100
        });

        player.addListener('ready', ({ device_id: id }) => { 
            device_id = id;
            console.log("Spotify Ready - Device ID:", id);
        });

        player.connect();
    };
}

// PLAYBACK
async function toggleSong(spotifyUri, element) {
    if (!spotifyUri) return alert("No song assigned!");
    if (!device_id) return alert("Connect Spotify First!");

    if (currentBtn === element) {
        element.classList.add('stopping');
        fadeOutSpotify();
        return;
    }
    if (currentBtn) return; 

    const lineupIndex = Array.from(document.querySelectorAll('.lineup-item')).indexOf(element);
    if (lineupIndex !== -1) lastPlayedIndex = lineupIndex;

    document.body.classList.add('audio-active');
    currentBtn = element;
    element.classList.add('playing', 'playing-active');
    
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${device_id}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [spotifyUri] }),
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${access_token}` }
    });
}

function fadeOutSpotify() {
    if (fadeInterval) return;
    const fadeTime = parseInt(document.getElementById('fade-speed').value);
    let tempVol = globalVolume;
    const step = 5;
    const interval = fadeTime / (tempVol / step);

    fadeInterval = setInterval(async () => {
        if (tempVol > step) {
            tempVol -= step;
            player.setVolume(tempVol / 100);
        } else {
            clearInterval(fadeInterval);
            fadeInterval = null;
            await player.pause();
            player.setVolume(globalVolume / 100); 
            resetStatesAfterAudio();
        }
    }, interval);
}

function resetStatesAfterAudio() {
    if (currentBtn) {
        currentBtn.classList.remove('playing', 'stopping', 'playing-active');
    }
    document.body.classList.remove('audio-active');
    currentBtn = null;
    updateHighlighting();
    saveLineupState();
}

// ROSTER & SEARCH
async function searchSpotify(query, playerId) {
    if (query.length < 3) return;
    const resp = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, {
        headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const data = await resp.json();
    const resultsContainer = document.getElementById(`results-${playerId}`);
    resultsContainer.innerHTML = data.tracks.items.map(t => `
        <div class="search-item" onclick="assignTrack(${playerId}, '${t.uri}', '${t.name.replace(/'/g, "\\'")} - ${t.artists[0].name.replace(/'/g, "\\'")}')">
            ${t.name} - ${t.artists[0].name}
        </div>
    `).join('');
}

function assignTrack(playerId, uri, name) {
    const transaction = db.transaction(["players"], "readwrite");
    const store = transaction.objectStore("players");
    store.get(playerId).onsuccess = (e) => {
        const data = e.target.result;
        data.spotifyUri = uri;
        data.trackName = name;
        store.put(data);
    };
    transaction.oncomplete = () => refreshRosterUI();
}

function refreshRosterUI() {
    const transaction = db.transaction(["players"], "readonly");
    const store = transaction.objectStore("players");
    const request = store.getAll();
    request.onsuccess = () => {
        const rosterEl = document.getElementById('roster');
        const subsEl = document.getElementById('subs-list');
        if(!rosterEl || !subsEl) return;
        rosterEl.innerHTML = ""; subsEl.innerHTML = "";
        const players = [...request.result].sort((a,b) => parseInt(a.number) - parseInt(b.number));

        players.forEach(p => {
            const card = document.createElement('div');
            card.className = 'roster-item';
            card.innerHTML = `
                <div class="player-info">#${p.number} ${p.name}</div>
                <div style="font-size:0.75rem; color:#1DB954; margin-top:5px; font-weight:bold;">${p.trackName || 'No track assigned'}</div>
                <input type="text" class="spotify-search-input" placeholder="Search song..." onkeyup="searchSpotify(this.value, ${p.id})">
                <div id="results-${p.id}" class="search-results"></div>
                <div style="margin-top:10px; display:flex; gap:10px;">
                    <button onclick="addToLineup(${p.id}, '${p.name.replace(/'/g, "\\'")}', '${p.number}', '${p.spotifyUri}')" style="background:#27ae60; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">+ Lineup</button>
                    <button onclick="deletePlayer(${p.id})" style="background:#c0392b; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Delete</button>
                </div>
            `;
            rosterEl.appendChild(card);

            const sBtn = document.createElement('button');
            sBtn.className = 'sub-item-btn';
            sBtn.innerHTML = `<strong>#${p.number}</strong> ${p.name}`;
            sBtn.onclick = () => toggleSong(p.spotifyUri, sBtn);
            subsEl.appendChild(sBtn);
        });
    };
}

// LINEUP
function addToLineup(id, name, number, uri) {
    if (!uri || uri === 'undefined') return alert("Assign a track first!");
    const el = createLineupElement(id, name, number, uri);
    document.getElementById('lineup').appendChild(el);
    saveLineupState();
    updateHighlighting();
}

function createLineupElement(id, name, number, uri) {
    const div = document.createElement('div');
    div.className = 'lineup-item';
    div.setAttribute('data-uri', uri);
    div.setAttribute('data-name', name);
    div.setAttribute('data-number', number);
    div.innerHTML = `
        <button class="play-trigger" onclick="toggleSong('${uri}', this.parentElement)">
            <strong>#${number}</strong> ${name}
        </button>
        <button class="remove-from-lineup" onclick="this.parentElement.remove(); saveLineupState();">❌</button>
    `;
    return div;
}

function saveLineupState() {
    const items = Array.from(document.querySelectorAll('.lineup-item')).map(i => ({
        uri: i.getAttribute('data-uri'),
        name: i.getAttribute('data-name'),
        number: i.getAttribute('data-number')
    }));
    localStorage.setItem('spotifyLineup', JSON.stringify(items));
    localStorage.setItem('lastPlayedIndex', lastPlayedIndex);
}

function loadLineupState() {
    const saved = JSON.parse(localStorage.getItem('spotifyLineup') || '[]');
    lastPlayedIndex = parseInt(localStorage.getItem('lastPlayedIndex') || '-2');
    const lineupEl = document.getElementById('lineup');
    if(!lineupEl) return;
    saved.forEach(p => lineupEl.appendChild(createLineupElement(null, p.name, p.number, p.uri)));
    updateHighlighting();
}

function updateHighlighting() {
    document.querySelectorAll('.lineup-item').forEach((item, idx) => {
        item.classList.remove('on-deck');
        if (lastPlayedIndex !== -2) {
            if (lastPlayedIndex === -1 && idx === 0) item.classList.add('on-deck');
            else if (idx === lastPlayedIndex + 1) item.classList.add('on-deck');
        }
    });
}

function toggleEditMode() {
    isLocked = !isLocked;
    document.body.classList.toggle('locked', isLocked);
    const btn = document.getElementById('lock-toggle');
    if(btn) btn.textContent = isLocked ? "🔓 Unlock to Edit" : "🔒 Lock & Save";
    refreshRosterUI();
}

function toggleSubs() { 
    const drawer = document.getElementById('subs-drawer');
    if(drawer) drawer.classList.toggle('closed'); 
}
function resetActiveBatter() { lastPlayedIndex = -2; updateHighlighting(); }
function updateSpotifyVolume(v) { globalVolume = v; if(player) player.setVolume(v/100); }

function addNewPlayer() {
    const nameInput = document.getElementById('new-player-name');
    const numInput = document.getElementById('new-player-number');
    if (!nameInput.value) return;
    const trans = db.transaction(["players"], "readwrite");
    trans.objectStore("players").add({ name: nameInput.value, number: numInput.value, spotifyUri: '', trackName: '' });
    trans.oncomplete = () => { 
        refreshRosterUI(); 
        nameInput.value = ''; 
        numInput.value = ''; 
    };
}

function deletePlayer(id) {
    if (!confirm("Delete player?")) return;
    const trans = db.transaction(["players"], "readwrite");
    trans.objectStore("players").delete(id);
    trans.oncomplete = () => refreshRosterUI();
}

function clearLineup() { 
    if(confirm("Clear batting order?")) { 
        document.getElementById('lineup').innerHTML = ""; 
        lastPlayedIndex = -2; 
        saveLineupState(); 
        updateHighlighting(); 
    } 
}

// Initial Sortable setup
const lineupEl = document.getElementById('lineup');
if(lineupEl) {
    Sortable.create(lineupEl, {
        animation: 150, onEnd: () => { saveLineupState(); updateHighlighting(); }
    });
}

