/*
 * (C) Copyright 2014 Kurento (http://kurento.org/)
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the GNU Lesser General Public License
 * (LGPL) version 2.1 which accompanies this distribution, and is available at
 * http://www.gnu.org/licenses/lgpl-2.1.html
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 */
var UserRegistry = require('./user-registry.js');
var UserSession = require('./user-session.js');

// store global variables
var userRegistry = new UserRegistry();
var rooms = {};

var express = require('express');

// kurento required
var path = require('path');
var minimist = require('minimist');
var url = require('url');
var kurento = require('kurento-client');

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: "http://192.168.1.7:8080/",
        ws_uri: "ws://192.168.1.13:8888/kurento"
    }
});

var kurentoClient = null;

/*
 * Server startup
 */

var app = express();
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = app.listen(port, function () {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var io = require('socket.io')(server);

io.on('connection', function (socket) {
    console.log('receive new client : ' + socket.id);
    socket.emit('id', socket.id);

    socket.on('error', function (data) {
        console.log('Connection: ' + socket.id + ' error : ' + data);
        stop(socket.id);
    });

    socket.on('close', function (data) {
        console.log('Connection: ' + socket.id + ' close : ' + data);
        stop(socket.id);
    });

    socket.on('message', function (message) {
        // console.log('Connection: ' + socket.id + ' receive message: ' + message.id);

        switch (message.id) {
            case 'joinRoom':
                console.log(socket.id + ' joinRoom : ' + message.roomName);
                joinRoom(socket, message.roomName, function () {

                });
                break;
            case 'receiveVideoFrom':
                console.log(socket.id + ' receiveVideoFrom : ' + message.sender);
                receiveVideoFrom(socket, message.sender, message.sdpOffer, function () {

                });
                break;
            case 'leaveRoom':
                console.log(socket.id + ' leaveRoom : ' + message.roomName);
                leaveRoom(socket);
                break;
            case 'onIceCandidate':
                addIceCandidate(socket, message);
                break;
            default:
                socket.emit({id: 'error', message: 'Invalid message ' + message});
        }
    });
});

function joinRoom(socket, roomName, callback) {
    getRoom(roomName, function (error, room) {
        if (error) {
            callback(error)
        }

        join(socket, room, function (error, user) {
            console.log('join success : ' + user.id);
        });
    });
}

function getRoom(roomName, callback) {

    var room = rooms[roomName];

    if (room == null) {
        console.log('create new room : ' + roomName);
        getKurentoClient(function (error, kurentoClient) {
            if (error) {
                return callback(error);
            }

            // create pipeline
            kurentoClient.create('MediaPipeline', function (error, pipeline) {
                if (error) {
                    return callback(error);
                }

                room = {
                    name: roomName,
                    pipeline: pipeline,
                    participants: {}
                };
                rooms[roomName] = room;
                callback(null, room);
            });
        });
    } else {
        console.log('get existing room : ' + roomName);
        callback(null, room);
    }
}

function join(socket, room, callback) {
    // create user session
    var userSession = new UserSession(socket.id, socket, room.name);
    room.pipeline.create('WebRtcEndpoint', function (error, outgoingMedia) {
        if (error) {
            // no participants in room yet release pipeline
            if (Object.keys(room.participants).length == 0) {
                room.pipeline.release();
            }
            return callback(error);
        }
        userSession.outgoingMedia = outgoingMedia;

        outgoingMedia.on('OnIceCandidate', function (event) {
            var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
            userSession.sendMessage({
                id: 'iceCandidate',
                sessionId: userSession.id,
                candidate: candidate
            })
        });

        // notify other user that new user is joining
        var usersInRoom = room.participants;
        var data = {
            id: 'newParticipantArrived',
            new_user_id: userSession.id
        };

        // notify existing user
        for (var i in usersInRoom) {
            usersInRoom[i].sendMessage(data);
        }

        var existingUserIds = [];
        for (var i in room.participants) {
            existingUserIds.push(usersInRoom[i].id);
        }
        // send list of current user in the room to current participant
        userSession.sendMessage({
            id: 'existingParticipants',
            data: existingUserIds,
            roomName: room.name
        });

        // register user to room
        room.participants[userSession.id] = userSession;

        // register user in system
        userRegistry.register(userSession);
        callback(null, userSession);
    });
}

function receiveVideoFrom(socket, senderId, sdpOffer, callback) {
    var userSession = userRegistry.getById(socket.id);
    var sender = userRegistry.getById(senderId);

    getEndpointForUser(userSession, sender, function (error, endpoint) {
        if (error) {
            callback(error);
        }

        endpoint.processOffer(sdpOffer, function (error, sdpAnswer) {
            if (error) {
                return callback(error);
            }
            var data = {
                id: 'receiveVideoAnswer',
                sessionId: sender.id,
                sdpAnswer: sdpAnswer
            };
            userSession.sendMessage(data);
            return callback(null, sdpAnswer);
        });

        endpoint.gatherCandidates(function (error) {
            if (error) {
                return callback(error);
            }
        });
    });
}

function getEndpointForUser(userSession, sender, callback) {
    // request for self media
    if (userSession.id === sender.id) {
        callback(null, userSession.outgoingMedia);
        return;
    }

    var incoming = userSession.incomingMedia[sender.id];
    if (incoming == null) {
        console.log('user : ' + userSession.id + ' create endpoint to receive video from : ' + sender.id);
        getRoom(userSession.roomName, function (error, room) {
            if (error) {
                return callback(error);
            }

            room.pipeline.create('WebRtcEndpoint', function (error, incomingMedia) {
                if (error) {
                    // no participants in room yet release pipeline
                    if (Object.keys(room.participants).length == 0) {
                        room.pipeline.release();
                    }
                    return callback(error);
                }
                incomingMedia.on('OnIceCandidate', function (event) {
                    var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
                    userSession.sendMessage({
                        id: 'iceCandidate',
                        sessionId: userSession.id,
                        candidate: candidate
                    });
                });
                userSession.incomingMedia[sender.id] = incomingMedia;
                sender.outgoingMedia.connect(incomingMedia, function (error) {
                    if (error) {
                        callback(error);
                    }
                    callback(null, incomingMedia);
                });

            });
        });
    } else {
        console.log('user : ' + userSession.id + ' get existing endpoint to receive video from : ' + sender.id);
        sender.outgoingMedia.connect(incoming, function (error) {
            if (error) {
                callback(error);
            }
            callback(null, incoming);
        });
    }
}

function leaveRoom(socket, callback) {
    var userSession = userRegistry.getById(socket.id);
    var room = rooms[userSession.roomName];

    console.log('notify all user that ' + sessionId + ' is leaving the room');

    var usersInRoom = room.participants;
    delete usersInRoom[sessionId];

    userSession.outgoingMedia.release();
    // release incoming media for the leaving user
    for (var i in userSession.incomingMedia) {
        userSession.incomingMedia[i].release();
        delete userSession.incomingMedia[i];
    }

    var data = {
        id: 'participantLeft',
        sessionId: sessionId
    };
    for (var i in usersInRoom) {
        var user = usersInRoom[i];
        // release viewer from this
        user.incomingMedia[sessionId].release();
        delete user.incomingMedia[sessionId];

        // notify all user in the room
        user.sendMessage(data);
    }
    stop(userSession.id);
}

function stop(sessionId) {
    userRegistry.unregister(sessionId);
}

function addIceCandidate(socket, message) {

    var user = userRegistry.getById(socket.id);
    if (user) {
        // assign type to IceCandidate
        var candidate = kurento.register.complexTypes.IceCandidate(message.candidate);
        user.addIceCandidate(message, candidate);
    }
}

/*function clearCandidatesQueue(sessionId) {
 if (candidatesQueue[sessionId]) {
 delete candidatesQueue[sessionId];
 }
 }

 function onIceCandidate(sessionId, message) {
 var candidate = kurento.register.complexTypes.IceCandidate(message.candidate);

 var caller = userRegistry.getById(sessionId);
 var room = rooms[caller.roomName];
 var callee = userRegistry.getById(message.sesssionId);

 if (room.pipeline) {
 if (pipeline) {

 } else {

 }
 }

 if (pipelines[user.id] && pipelines[user.id].webRtcEndpoint && pipelines[user.id].webRtcEndpoint[user.id]) {
 var webRtcEndpoint = pipelines[user.id].webRtcEndpoint[user.id];
 webRtcEndpoint.addIceCandidate(candidate);
 }
 else {
 if (!candidatesQueue[user.id]) {
 candidatesQueue[user.id] = [];
 }
 candidatesQueue[sessionId].push(candidate);
 }
 }*/

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function (error, _kurentoClient) {
        if (error) {
            var message = 'Coult not find media server at address ' + argv.ws_uri;
            return callback(message + ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

app.use(express.static(path.join(__dirname, 'static')));
