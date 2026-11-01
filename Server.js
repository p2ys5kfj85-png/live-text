
const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const html = String.raw`<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#101827">
<title>Live Text</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:18px;background:#101827;color:white;font-family:Arial,sans-serif}
main{max-width:600px;margin:auto}
h1{text-align:center;color:#55d6be}
.panel{background:#1d293b;border-radius:16px;padding:16px;margin:14px 0}
input,button,textarea{width:100%;padding:14px;margin-top:10px;border:0;border-radius:10px;font-size:16px}
input,textarea{background:#f4f6fa;color:#111827}
button{background:#55d6be;color:#102027;font-weight:bold;cursor:pointer}
button:disabled{opacity:.5}
video{width:100%;background:#080d15;border-radius:12px;margin-top:10px;aspect-ratio:16/9;object-fit:cover}
textarea{min-height:110px;resize:vertical}
#remoteText{min-height:90px;background:#111c2b;padding:14px;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere}
#status{text-align:center;color:#55d6be;min-height:24px}
.small{color:#b8c5d8;font-size:13px}
#callArea{display:none}
</style>
</head>
<body>
<main>
<h1>Live Text</h1>
<p id="status">Creează o cameră privată.</p>

<section class="panel" id="joinArea">
<label>Codul camerei</label>
<input id="room" maxlength="12" placeholder="Exemplu: AB1234">
<button id="joinButton">Intră în cameră</button>
<p class="small">Ambele persoane introduc același cod.</p>
</section>

<section id="callArea">
<div class="panel">
<h3>Celălalt participant</h3>
<video id="remoteVideo" autoplay playsinline></video>
</div>

<div class="panel">
<h3>Imaginea ta</h3>
<video id="localVideo" autoplay muted playsinline></video>
<button id="cameraButton">Oprește camera</button>
<button id="micButton">Oprește microfonul</button>
</div>

<div class="panel">
<h3>Scrie aici</h3>
<textarea id="myText" placeholder="Scrie... textul apare imediat la celălalt participant" disabled></textarea>
<p class="small">Nu există buton de trimitere.</p>
</div>

<div class="panel">
<h3>Text primit</h3>
<div id="remoteText">Așteptăm textul...</div>
</div>

<button id="leaveButton">Închide conversația</button>
</section>
</main>

<script>
const $ = id => document.getElementById(id);
let socket=null, peer=null, channel=null, localStream=null;
let joined=false, pendingCandidates=[], cameraOn=true, micOn=true;

const rtcConfig={
  iceServers:[{urls:"stun:stun.l.google.com:19302"}]
};

function status(text){$("status").textContent=text;}

function signal(data){
  if(socket && socket.readyState===WebSocket.OPEN){
    socket.send(JSON.stringify({type:"signal",data}));
  }
}

function setupChannel(ch){
  channel=ch;
  channel.onopen=()=>{
    $("myText").disabled=false;
    status("Conectat! Puteți vorbi și scrie.");
  };
  channel.onmessage=e=>{
    $("remoteText").textContent=e.data;
  };
  channel.onclose=()=>{
    $("myText").disabled=true;
  };
}

function createPeer(){
  peer=new RTCPeerConnection(rtcConfig);

  peer.onicecandidate=e=>{
    if(e.candidate){
      signal({kind:"candidate",candidate:e.candidate});
    }
  };

  peer.ontrack=e=>{
    $("remoteVideo").srcObject=e.streams[0];
  };

  peer.ondatachannel=e=>setupChannel(e.channel);

  localStream.getTracks().forEach(track=>{
    peer.addTrack(track,localStream);
  });
}

async function makeOffer(){
  const offer=await peer.createOffer();
  await peer.setLocalDescription(offer);
  signal({kind:"description",description:peer.localDescription});
}

async function handleSignal(data){
  try{
    if(data.kind==="description"){
      await peer.setRemoteDescription(data.description);

      while(pendingCandidates.length){
        await peer.addIceCandidate(pendingCandidates.shift());
      }

      if(data.description.type==="offer"){
        const answer=await peer.createAnswer();
        await peer.setLocalDescription(answer);
        signal({kind:"description",description:peer.localDescription});
      }
    }

    if(data.kind==="candidate" && data.candidate){
      if(peer.remoteDescription){
        await peer.addIceCandidate(data.candidate);
      }else{
        pendingCandidates.push(data.candidate);
      }
    }
  }catch(error){
    console.error(error);
    status("Eroare la conectarea apelului.");
  }
}

async function joinRoom(){
  if(joined)return;

  const room=$("room").value.trim().toUpperCase();
  if(!/^[A-Z0-9]{4,12}$/.test(room)){
    status("Introdu un cod de 4–12 caractere.");
    return;
  }

  $("joinButton").disabled=true;

  try{
    if(!navigator.mediaDevices?.getUserMedia){
      throw new Error("Este necesară o conexiune HTTPS.");
    }

    localStream=await navigator.mediaDevices.getUserMedia({
      video:true,audio:true
    });

    $("localVideo").srcObject=localStream;

    const protocol=location.protocol==="https:"?"wss:":"ws:";
    socket=new WebSocket(protocol+"//"+location.host);

    socket.onopen=()=>{
      socket.send(JSON.stringify({type:"join",room}));
    };

    socket.onmessage=async event=>{
      const msg=JSON.parse(event.data);

      if(msg.type==="error"){
        status(msg.message);
        cleanup();
        return;
      }

      if(msg.type==="joined"){
        joined=true;
        $("joinArea").style.display="none";
        $("callArea").style.display="block";
        status(msg.count===1?
          "Camera creată. Așteptăm a doua persoană...":
          "Participant conectat.");
        createPeer();
      }

      if(msg.type==="peer-joined"){
        if(!channel){
          setupChannel(peer.createDataChannel("live-text"));
        }
        await makeOffer();
      }

      if(msg.type==="signal"){
        await handleSignal(msg.data);
      }

      if(msg.type==="peer-left"){
        $("remoteVideo").srcObject=null;
        $("remoteText").textContent="Celălalt participant a ieșit.";
        $("myText").disabled=true;
        status("Celălalt participant a închis conversația.");
      }
    };

    socket.onerror=()=>{
      status("Eroare de conexiune la server.");
    };

  }catch(error){
    console.error(error);
    status("Nu pot accesa camera sau microfonul. Verifică HTTPS și permisiunile.");
    $("joinButton").disabled=false;
    if(localStream){
      localStream.getTracks().forEach(t=>t.stop());
      localStream=null;
    }
  }
}

function cleanup(){
  joined=false;

  if(channel){channel.close();channel=null;}
  if(peer){peer.close();peer=null;}
  if(socket){socket.close();socket=null;}

  if(localStream){
    localStream.getTracks().forEach(t=>t.stop());
    localStream=null;
  }

  $("localVideo").srcObject=null;
  $("remoteVideo").srcObject=null;
  $("myText").value="";
  $("myText").disabled=true;
  $("remoteText").textContent="";
  $("callArea").style.display="none";
  $("joinArea").style.display="block";
  $("joinButton").disabled=false;

  pendingCandidates=[];
  cameraOn=true;
  micOn=true;

  $("cameraButton").textContent="Oprește camera";
  $("micButton").textContent="Oprește microfonul";
  status("Conversația s-a încheiat. Textul local a fost șters.");
}

$("joinButton").onclick=joinRoom;

$("myText").addEventListener("input",()=>{
  if(channel && channel.readyState==="open"){
    channel.send($("myText").value);
  }
});

$("leaveButton").onclick=cleanup;

$("cameraButton").onclick=()=>{
  if(!localStream)return;
  cameraOn=!cameraOn;
  localStream.getVideoTracks().forEach(t=>t.enabled=cameraOn);
  $("cameraButton").textContent=cameraOn?"Oprește camera":"Pornește camera";
};

$("micButton").onclick=()=>{
  if(!localStream)return;
  micOn=!micOn;
  localStream.getAudioTracks().forEach(t=>t.enabled=micOn);
  $("micButton").textContent=micOn?"Oprește microfonul":"Pornește microfonul";
};

window.addEventListener("beforeunload",()=>{
  if(socket)socket.close();
  if(peer)peer.close();
  if(localStream)localStream.getTracks().forEach(t=>t.stop());
});
</script>
</body>
</html>`;

const server=http.createServer((req,res)=>{
  if(req.url!=="/" && req.url!=="/index.html"){
    res.writeHead(404);
    return res.end("Not found");
  }

  res.writeHead(200,{
    "Content-Type":"text/html; charset=utf-8",
    "Cache-Control":"no-store"
  });
  res.end(html);
});

const wss=new WebSocket.Server({server});

function send(ws,data){
  if(ws.readyState===WebSocket.OPEN){
    ws.send(JSON.stringify(data));
  }
}

wss.on("connection",ws=>{
  ws.on("message",raw=>{
    let msg;
    try{msg=JSON.parse(raw.toString());}
    catch{return;}

    if(msg.type==="join"){
      const room=String(msg.room||"").trim().toUpperCase();

      if(!/^[A-Z0-9]{4,12}$/.test(room)){
        return send(ws,{type:"error",message:"Cod invalid."});
      }

      let members=rooms.get(room);
      if(!members){
        members=new Set();
        rooms.set(room,members);
      }

      if(members.size>=2){
        return send(ws,{type:"error",message:"Camera este ocupată."});
      }

      const existing=[...members];
      members.add(ws);
      ws.room=room;

      send(ws,{type:"joined",count:members.size});

      if(existing.length===1){
        send(existing[0],{type:"peer-joined"});
      }
      return;
    }

    if(!ws.room)return;
    const members=rooms.get(ws.room);
    if(!members)return;

    for(const member of members){
      if(member!==ws){
        send(member,{type:"signal",data:msg.data});
      }
    }
  });

  ws.on("close",()=>{
    if(!ws.room)return;

    const members=rooms.get(ws.room);
    if(!members)return;

    members.delete(ws);

    for(const member of members){
      send(member,{type:"peer-left"});
    }

    if(members.size===0){
      rooms.delete(ws.room);
    }
  });
});

server.listen(PORT,()=>{
  console.log("Live Text pornit pe portul "+PORT);
});
