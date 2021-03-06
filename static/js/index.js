/**
 * Created by eak on 9/14/15.
 */

var socket = io.connect();
var mainVideoCurrentId;
var mainVideo;
var sessionId;

var participants = {};

$(document).ready(function () {
    $("#register").click(function () {
        $("#register").prop("disabled", true);
        register();
    });
});

window.onload = function () {
    mainVideo = $("#main_video")[0];
    /*webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function (error) {
     if (error) return onError(error);
     this.generateOffer(onOfferPresenter);
     });*/
};

window.onbeforeunload = function () {

    // clear main video
    mainVideo.pause();
    mainVideo.src = "";
    mainVideo.load();
    socket.disconnect();
};

socket.on("id", function (id) {
    console.log("receive id : " + id);
    sessionId = id;
});

// message handler
socket.on("message", function (message) {
    switch (message.id) {
        case "existingParticipants":
            console.log("existingParticipans : " + message.data);
            onExistingParticipants(message);
            break;
        case "newParticipantArrived":
            console.log("newParticipantArrived : " + message.new_user_id);
            onNewParticipant(message);
            break;
        case "participantLeft":
            console.log("participantLeft : " + message.sessionId);
            onParticipantLeft(message);
            break;
        case "receiveVideoAnswer":
            console.log("receiveVideoAnswer from : " + message.sessionId);
            onReceiveVideoAnswer(message);
            break;
        case "iceCandidate":
            console.log("iceCandidate from : " + message.sessionId);
            var participant = participants[message.sessionId];
            if (participant != null) {
                console.log(message.candidate);
                //if (participant.isAnswer) {
                participant.rtcPeer.addIceCandidate(message.candidate, function (error) {
                    if (error) {
                        if (message.sessionId === sessionId) {
                            console.error("Error adding candidate to self : " + error);
                        } else {
                            console.error("Error adding candidate : " + error);
                        }
                    }
                });
                /*} else {
                 console.error('still does not answer rtc peer for : ' + message.sessionId);
                 participant.iceCandidateQueue.push(message.candidate);
                 }*/
            } else {
                console.error('still does not establish rtc peer for : ' + message.sessionId);
            }
            break;
        default:
            console.error("Unrecognized message: ", message);
    }
});

function sendMessage(data) {
    socket.emit("message", data);
}

function register() {
    var data = {
        id: "joinRoom",
        roomName: "Test"
    };
    sendMessage(data);
}

function onExistingParticipants(message) {
    // var isFirefox = typeof InstallTrigger !== 'undefined';
    // if (!isFirefox) {
    var constraints = {
        audio: true,
        video: {
            mandatory: {
                maxWidth: 320,
                maxFrameRate: 15,
                minFrameRate: 15
            }
        }
    };
    console.log(sessionId + " register in room " + message.roomName);

    // create video for current user to send to server
    var localParticipant = new Participant(sessionId);
    participants[sessionId] = localParticipant;
    var video = createVideoForParticipant(localParticipant);

    // bind function so that calling 'this' in that function will receive the current instance
    var options = {
        localVideo: video,
        mediaConstraints: constraints,
        onicecandidate: localParticipant.onIceCandidate.bind(localParticipant)
    };

    localParticipant.rtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function (error) {
        if (error) {
            return console.error(error);
        }

        // initial main video to local first
        mainVideoCurrentId = sessionId;
        mainVideo.src = localParticipant.rtcPeer.localVideo.src;
        mainVideo.muted = true;

        console.log("local participant id : " + sessionId);
        this.generateOffer(localParticipant.offerToReceiveVideo.bind(localParticipant));
    });
    // }

    // get access to video from all the participants
    console.log(message.data);
    for (var i in message.data) {
        receiveVideoFrom(message.data[i]);
    }
}

function receiveVideoFrom(sender) {
    console.log(sessionId + " receive video from " + sender);
    var participant = new Participant(sender);
    participants[sender] = participant;

    var video = createVideoForParticipant(participant);

    // bind function so that calling 'this' in that function will receive the current instance
    var options = {
        remoteVideo: video,
        onicecandidate: participant.onIceCandidate.bind(participant)
    };

    participant.rtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function (error) {
        if (error) {
            return console.error(error);
        }
        this.generateOffer(participant.offerToReceiveVideo.bind(participant));
    });
}

function onNewParticipant(message) {
    receiveVideoFrom(message.new_user_id)
}

function onParticipantLeft(message) {
    var participant = participants[message.sessionId];
    participant.dispose();
    delete participants[message.sessionId];

    // remove video tag
    $("#video-" + participant.id).remove();
}

function onReceiveVideoAnswer(message) {
    var participant = participants[message.sessionId];
    participant.rtcPeer.processAnswer(message.sdpAnswer, function (error) {
        if (error) {
            console.error(error);
        } else {
            participant.isAnswer = true;
            while (participant.iceCandidateQueue.length) {
                console.error("collected : " + participant.id + " ice candidate");
                var candidate = participant.iceCandidateQueue.shift();
                participant.rtcPeer.addIceCandidate(candidate);
            }
        }
    });
}

function createVideoForParticipant(participant) {

    var videoId = "video-" + participant.id;
    var videoHtml = '<video id="' + videoId + '" autoplay width="320px" height="240px" poster="img/webrtc.png"></video>';
    $("#video_list").append(videoHtml);

    // return video element
    return $("#" + videoId)[0];
}
