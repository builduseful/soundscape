var log = console.log;

const audioContext = new AudioContext();

// Create the source.
var source = audioContext.createBufferSource();
// Create the gain node.
var gain = audioContext.createGain();
// Connect source to filter, filter to destination.
source.connect(gain);
gain.connect(audioContext.destination);

var request = new XMLHttpRequest();
request.open('GET', "rain-from-room-loop-smallest.ogg", true);
request.responseType = 'arraybuffer';
request.onload = function () {
    audioContext.decodeAudioData(request.response, function (theBuffer) {
        buffer = theBuffer;
    });
}
request.send();

function playSound(buffer) {
    var source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(audioContext.destination);
    source.start(0);
}

function playAudio() {
    playSound(buffer);
}