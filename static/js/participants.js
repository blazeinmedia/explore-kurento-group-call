/**
 * Created by eak on 9/15/15.
 */
function Participant(id) {
    this.id = id;
    this.rtcPeer = null;

    this.offerToReceiveVideo = function (error, offerSdp) {
        if (error) {
            return console.error("sdp offer error");
        }
        var msg = {
            id: "receiveVideoFrom",
            sender: id,
            sdpOffer: offerSdp
        };
        console.log('Invoking SDP offer callback function ' + msg.sender);
        sendMessage(msg);
    };

    this.onIceCandidate = function (candidate) {
        console.log("Local candidate" + JSON.stringify(candidate));

        var message = {
            id: 'onIceCandidate',
            candidate: candidate,
            sender: id
        };
        sendMessage(message);
    };

    this.dispose = function () {
        console.log('Disposing participant ' + this.id);
        this.rtcPeer.dispose();
        this.rtcPeer = null;
    };
}