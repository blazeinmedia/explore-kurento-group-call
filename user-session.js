/**
 * Created by eak on 9/14/15.
 */
function UserSession(id, socket, roomName) {
    this.id = id;
    this.socket = socket;
    this.sdpOffer = null;
    this.outgoingMedia = null;
    this.incomingMedia = {};
    this.roomName = roomName;
}


UserSession.prototype.addIceCandidate = function (data, candidate) {
    // ice candidate for this user
    if (data.sender === this.id) {
        console.log(' add candidate to self : ' + data.sender);
        this.outgoingMedia.addIceCandidate(candidate);
    } else {
        var webRtc = this.incomingMedia[data.sender];
        if (webRtc) {
            console.log(this.id + ' add candidate to from : ' + data.sender);
            webRtc.addIceCandidate(candidate);
        }
    }
};

UserSession.prototype.sendMessage = function (data) {
    this.socket.emit('message', data);
};

module.exports = UserSession;