/**
* this is the web worker running in the background.
* it's the heart of the sequencer, trying to provide a stable clock,
* moving the playback along.
*/
var starttime = 0;
var millisec = 0;
var sec = 0;
var secstamp = 0;
var min = 0;
var hour = 0;
var stop = true;
var stoptime = 0;
var time = '00:00:00';
var bpm=120;
var steplength=(60/(bpm*4))*1000;
var currentstep=1;
var currenttimer=0;
var swingstep=0;
var swingpointer=0;
var steplengths=[];

/**
* starts the timer
*/
function start_timer() {
	starttime = new Date().getTime();
	timer();
}

/**
* continuing playback from within a pattern
*/
function continue_timer() {
	var timenow = new Date().getTime();
	stoptime = (timenow - starttime) - millisec;
	timer();
}

/**
* The most important part in here.
* Move clock ahead one millisecond. 
*/
function timer() {
	if (!stop) {
		setTimeout("set_new_time()", 1);
	}
}

/**
* iterates through the 16 steps in a pattern,
* moving forward by one step each time the timer
* moves past the step length (in milliseconds)
*/
function set_new_time() {
	if (currenttimer==0) {
		self.postMessage({'step' : currentstep});
		currentstep++;
		if (currentstep>16) {
			currentstep=1;
		}
	}
	currenttimer++;
	sl=steplengths[swingpointer];
	if (currenttimer>=sl) {
		swingpointer++;
		if (swingpointer==2) {
			swingpointer=0;
		}
		currenttimer=0;
	}
	timer();
}

/**
* This reacts to messages sent by the web app. Should be self-explanatory
*/
self.addEventListener('message', function(e) {
	var data = e.data;
	switch (data.cmd) {
		case 'start':
			if(stop){
				stop = false;
				start_timer(data);
			}
			break;
		case 'continue':
			stop = false;
			continue_timer(data);
			break;
		case 'swing':
			swingstep=Math.round((steplength/100)*(100-data.swing));
			var diff=steplength-swingstep;
			steplengths=[(steplength+diff),(steplength-diff)];
			break;
		case 'stop':
			stop = true;
			currentstep=1;
			break;
		case 'close':
			self.close();
			// Terminates the worker.
			break;
		case 'bpm':
			bpm=data.bpm;
			steplength=Math.round((60/(bpm*16))*1000);
			swingstep=Math.round((steplength/100)*(100-data.swing));
			var diff=steplength-swingstep;
			steplengths=[(steplength+diff),(steplength-diff)];
		break;
		default:
			self.postMessage('Unknown command: ' + data.msg);
	};

}, false);