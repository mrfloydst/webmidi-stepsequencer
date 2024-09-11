/**
* 16 STEP MULTITRACK MIDI SEQUENCER
* (c) Floyd Steinberg, 2021
* 
* this script is the main routine which does all the midi and GUI stuff.
* it receives a "pulse" from a web worker and plays back midi commands stored in the HTML DOM
* this uses jQuery for retriving the MIDI data drom the DOM quickly.
* 
* The basic idea here is that every pattern and track is represented by an ordered list <ul> <li>
* Each <li> item contains MIDI info stored in data attributes.
* jQuery will read those data attributes for each track in a measure and send it to the midi device selected for that track.
* 
* 1. we need to declare some global variables (because I'm lazy and this totally works and chances you need to use this with other JS apps are slim)
*/
var midi = null;  			// global MIDIAccess object
var active=0;				// number of the slot (1-16) the user is working on by holding down a button
var timer_worker;			// a slot the web worker can run in
var outputdevice={};		// stores the ids of the MIDI devices connected to your computer
var midi_outputs={};		// stores the handles of the MIDI devices we can send data to
var noteon="1001";			// binary code for turning on a note
var noteoff="1000";			// " for turning off a note
var midichannel="0000";		// " for selecting the midi channel the note gets played on
var pattern=0;				// the patter currently playing
var nextpattern=[];			// the patterns playing next
var track=0;				// the track currently being worked on / visible in the gui
var swing=0;				// amount of swing in the piece
var ledtarget;				// midi controller with led status lights
var lastnote;				// the last note the user entered
var paste=false;			// pasting the last note entered holding the "set" button
var midilearn=false;		// if true, midi learning is active
var lastswitch=false		// last control used
var change_pattern=false;	// true if the pattern button is pressed
var midiassign={};			// stores button&knob assignments
var buttonassign={};		// stores the step selector button assignments (redundant, for faster access and readability)
var trackselectors=[];		// stores the track selector buttons
var ledorder=[];			// stores the order in which the step leds will light up
var playing=false;			// true if play button is pushed
var patternbutton=false;	// see if a pattern button is held (for transposing)
var transpose=[];			// stores transpose values for tracks
var notenames=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

/**
* functions are in alphabetical order
* 
* turn off all notes
*/
function allnotesoff(mode)
{
	var nf=parseInt(1011+midichannel,2);
	switch (mode) {
		case "patternswitch":
			$(".track").each(function() {
				var t=$(this).attr("data-tracknumber");
				midi_outputs["track"+t].send([nf,123,100]);
			});
			break;
		case "pattern":
			$(".track").each(function() {
				var t=$(this).attr("data-tracknumber");
				midi_outputs["track"+t].send([nf,123,100]);
				$("#pattern"+pattern+" #track"+t+" ul.grid li").removeAttr("data-noteoff");
			});
			break;
		case "stopbutton":
			var nf=parseInt(noteoff+midichannel,2);
			$(".track").each(function() {
				var t=$(this).attr("data-tracknumber");
				for (var i=0;i<128;i++) {
					midi_outputs["track"+t].send([nf,i,100]);
				}
			});
		break;
		default:
			midi_outputs["track"+track].send([nf,123,100]);
			$("#pattern"+pattern+" #track"+track+" ul.grid li").removeAttr("data-noteoff");
		break;
	}
}

/*
* assignmidicontrol
*/
function assignmidicontrol(d) {
	if(d[2]>0) {
		$("form#setup input:focus").val(d[1]);
		var ipfo=$("form#setup input:focus").parent().parent().next("tr").find("input");
		// move to the next input field
		if (lastswitch!=d[1]) {
			lastswitch=d[1];
			ipfo.focus();
		}
		var json={};
		var ar=$("form#setup").serializeArray();
		 jQuery.each(ar, function() {
			json[this.name] = this.value || '';
		});
		localStorage.midiassignments=JSON.stringify(json);
		if (ipfo.length<1) {
			$("p.youre_new").css("display","none");
			$("p.youre_new br").remove();
			$("#track0 label[for=inputdevice]").append($("p.youre_new #inputdevice"));
			toggleMidiLearning();
		}
	}
}

/**
* clears a track or the whole pattern
*/
function clear() {
	var clearthis="#pattern"+pattern+" #track"+track+" ul li";
	if (paste)
		clearthis="#pattern"+pattern+" ul.grid li";
	var c=0;
	$(clearthis).each(function() {
		c++;
		ct=c;
		if (c<10)
			ct="0"+c;
		$(this).html(ct);
		$(this).removeAttr("data-notelength");
		$(this).removeAttr("data-notepitch");
		$(this).removeAttr("data-velocity");
		$(this).removeAttr("data-noteoff");
		$(this).removeAttr("class");
	});
}

/**
* this attaches an event handler to the device selector dropdown menu
*/
function init_outputselectors(tracknumber)
{
	var tabsel="";
	if (typeof(tracknumber)!="undefined") {
		tabsel="#pattern"+pattern+" #track"+tracknumber+" ";
	}
	$(tabsel+"#device").on("change",function() {
		var opds={};
		$("select#device").each(function() {
			opds[$(this).parent().parent().parent().prop("id")]=$(this).val();
		});
		/**
		* store the user's selection for future use
		*/
		localStorage.setItem('outputdevice', JSON.stringify(opds));
		/*
		* enumerate all the midi devices and index the chosen one in the midi_outputs object,
		* so we can deduct which instrument will be played by the DOM id of the list the 
		* user is currently viewing.
		*/
		for (var entry of midi.outputs) {
			var output = entry[1];
			if (output.id==$(this).val()) {
				midi_outputs[$(this).parent().parent().parent().attr("id")]=output;
			}
		}
	});
}

function ledoff() {
	for (var i=0;i<ledorder.length;i++) {
		switchled([183,ledorder[i],0]);
	}
}

/**
* lists all MIDI devices (in- and output)
* builds a select element from that
* takes a look at the user choices in localstorage and
* preselects the one found there for the each track
* triggers a "change" event on those select boxes which initialises 
* the selected midi device
*/
function listInputsAndOutputs( midiAccess )
{
	/**
	* list all input devices
	*/
	for (var entry of midiAccess.inputs) {
		var input = entry[1];
		$("#inputdevice").append("<option value=\""+ input.id +"\">"+ input.name +"</option>");
	}
	
	/**
	* list all output devices
	*/
	for (var entry of midiAccess.outputs) {
		var output = entry[1];
		$("#device").append("<option value=\""+ output.id +"\">"+ output.name +"</option>");
	}

	/**
	* determine the preferred input device from the local storage and activate it
	*/
	if (typeof(localStorage.inputdevice)!="undefined") {
		$("#inputdevice option[value='"+localStorage.inputdevice+"']").attr('selected','selected');
		$('#inputdevice').trigger('change');
	}
	
	/**
	* find the last used output device on this track and preselect it
	*/
	if (typeof(localStorage.outputdevice)!="undefined") {
		try {
			outputdevice=JSON.parse(localStorage.outputdevice);
		} catch {
			outputdevice={track0:"input-0"};
		}
		$("select#device").each(function() {
			/**
			* remember, the track name is the HTML DOM id of the list, so we can find that by looking up the parent... id :-)
			*/
			$(this).find("option[value='"+outputdevice[$(this).parent().parent().parent().attr("id")]+"']").attr('selected','selected');
			$(this).trigger('change');
		});
	}
	setLEDDevice();
}

/**
* message if MIDI fails (for example, no https)
*/
function onMIDIFailure(msg)
{
	console.log( "Failed to get MIDI access - " + msg );
}

/**
* reacting to user inputs on a MIDI device
*/
function onMIDIMessage( event )
{
	/**
	* the Nanokontrol / non-keyboard was used
	*/
	if (event.srcElement.id==$("#inputdevice").val()) {
		/**
		* set the note (see function)
		*/
		setnote(event.data);
		/**
		* for debugging and further development
		*/
		var str = "MIDI message received at timestamp " + event.timestamp + "[" + event.data.length + " bytes]: ";
		for (var i=0; i<event.data.length; i++) {
			str += event.data[i] + " ";
		}
		console.log( str );
	}
	/**
	* user played a note on a keyboard
	* store note information in the currently active slot
	*/
	if (event.data[0].toString(2).substring(0,4)=="1001") {
		var d=event.data;
		$("#pattern"+pattern+" #track"+track+" #"+active).attr("data-notepitch",d[1]);
		$("#pattern"+pattern+" #track"+track+" #"+active).attr("data-velocity",d[2]);
		if (typeof($("#pattern"+pattern+" #track"+track+" #"+active).attr("data-notelength"))=="undefined") {
			$("#pattern"+pattern+" #track"+track+" #"+active).attr("data-notelength",1);
		}
		$("#pattern"+pattern+" #track"+track+" #"+active).html(notenames[d[1]%12]+parseInt(d[1]/12));
		console.log("Note played: "+d[1]);
	}
}

/**
* webmidi started successfully - we can start working!
*/
function onMIDISuccess( midiAccess )
{
	midi = midiAccess;  			// store in the global (yeah, why not. if it works, it works?)
	listInputsAndOutputs(midi);
	startLoggingMIDIInput(midi,1);
}

/**
* set transposes
*/
function pattern_transpose_set(p,t,d) {
	$("#transpose_info").css("display","block");
	d=Math.round((d-64)/5.4);
	e=d;
	if (d>0) {
		e="+"+d;
	}
	$("#transpose_info").html(e);
	transpose=[p,t,d];
	$("#pattern"+p+" #track"+t+" ul.grid>li").each(function() {
		if (typeof($(this).attr("data-notepitch"))!="undefined") {
			var ln=parseInt($(this).attr("data-notepitch"))+d;
			$(this).html(notenames[ln%12]+parseInt(ln/12));
		}
	});
}

/**
* transpose a whole pattern
*/
function pattern_transpose()
{
	$("#transpose_info").fadeOut();
	var p=transpose[0];
	var t=transpose[1];
	var d=transpose[2];
	$("#pattern"+p+" #track"+t+" ul.grid>li").each(function() {
		if (typeof($(this).attr("data-notepitch"))!="undefined") {
			$(this).attr("data-notepitch",parseInt($(this).attr("data-notepitch"))+d);
		}
		if (typeof($(this).attr("data-noteoff"))!="undefined") {
			$(this).attr("data-noteoff",parseInt($(this).attr("data-noteoff"))+d);
		}
	});
	transpose=[];
	allnotesoff("track");
}

/**
* reads all the lists in all the tracks of the current measure and 
* sends the MIDI commands found there to the selected MIDI devices
*/
function playStep(s)
{
	/*
	*	update GUI, blank all steps
	*/
	$(".grid li:not(.selected,.lengthchange,.fill)").prop("class","normal");
	$("#pattern"+pattern+" .track:not(.mute)").each(function() {
		var j=parseInt($(this).prop("id").replace("track",""));
		var mc=$("#pattern"+pattern+" #track"+j+" #channel").val();
		for (var i=1;i<17;i++) {
			var idname="b"+i;
			if (i<10)
				idname="b0"+i;
			if (i==s) {
				var led=s-1;
				if (i==1)
					led=16;
				switchled([183,ledorder[led],0]);
				switchled([183,ledorder[s],127]);
				/*
				*	current step is marked red
				*/
				$("#pattern"+pattern+" #track"+j+" #"+idname+":not(.selected,.lengthchange,.fill)").prop("class","active");
				/**
				* read MIDI data and send it, if available
				*/
				var np=$("#pattern"+pattern+" #track"+j+" #"+idname).attr("data-notepitch");
				var no=$("#pattern"+pattern+" #track"+j+" #"+idname).attr("data-noteoff");
				var vl=$("#pattern"+pattern+" #track"+j+" #"+idname).attr("data-velocity");
				if (midi_outputs["track"+j]!=null&&(parseInt(np)>0||parseInt(no)>0)) {
					if (typeof(vl)=="undefined"||vl<1||vl=="NaN") {
						vl=100;
					}
					else {
						vl=parseInt(vl);
					}
					var nf=parseInt(noteoff+mc,2);
					var nn=parseInt(noteon+mc,2);
					if (parseInt(no)>0) {
						midi_outputs["track"+j].send([nf,no,vl]);
					}
					if (parseInt(np)>0) {
						midi_outputs["track"+j].send([nn,np,vl]);
					}
				}
			}
		}
	});
	if (s==16&&nextpattern.length>0) {
		pattern=nextpattern.shift();
		allnotesoff("patternswitch");
	}
	if (s==1&&nextpattern.length>0) {
		$(".queue").html("<b>"+nextpattern.join("</b> <b>")+"</b>");
	}
}

/**
* make sure the noteoff command belonging to a specific note is removed.
*/
function removeNoteOff(step) {
	var pointer=parseInt(active.replace("b",""));
	var changeit=pointer+parseInt(step.attr("data-notelength"))+1;
	if (changeit>16)
		changeit=0;
	var change_id="#b"+changeit;
	if (changeit<10)
		change_id="#b0"+changeit;
	if (typeof(step.attr("data-notepitch"))!="undefined"&&$(change_id).attr("data-noteoff")==step.attr("data-notepitch"))
		$(change_id).removeAttr("data-noteoff");
}

/**
* sets the input device
*/
function setLEDDevice()
{
	for (var entry of midi.outputs) {
	/**
	* we will send led on signals to the controller which is the main input
	*/
		if (entry[1].name==$("#track"+track+" #inputdevice option:selected").text()) {
			ledtarget=entry[1];
			trackledon();
		}
	}
}

/**
* storing user input in the DOM.
* this is the heart of this sequencer, so it's a long function
* might need to break this down into smaller pieces further down the road
*/
function setnote(d)
{
	if (midilearn) {
		return assignmidicontrol(d);
	}
	var color="normal";
	if (d[2]==127) {
		color="selected";
	}
	/**
	* the less queries, the better.
	*/
	var activestep=$("#pattern"+pattern+" #track"+track+" #b01");
	if (typeof(buttonassign[d[1]])!="undefined") {
		active=buttonassign[d[1]];
		activestep=$("#pattern"+pattern+" #track"+track+" #"+active);
		activestep.prop("class",color);
		if (d[2]==0) {
			if ($("#pattern"+pattern+" #track"+track+" li.fill").length>0) {
				$("#pattern"+pattern+" #track"+track+" li.fill").attr("data-notepitch",lastnote[0]);
				$("#pattern"+pattern+" #track"+track+" li.fill").attr("data-notelength",lastnote[1]);
				$("#pattern"+pattern+" #track"+track+" li.fill").attr("data-velocity",lastnote[2]);
				$("#pattern"+pattern+" #track"+track+" li.fill").html(notenames[lastnote[0]%12]+parseInt(lastnote[0]/12));
				$("#pattern"+pattern+" #track"+track+" li.fill").removeAttr("class");
			}
			if ($("#pattern"+pattern+" #track"+track+" li.lengthchange").length>0) {
				var thisnote=activestep.attr("data-notepitch");
				$("#pattern"+pattern+" #track"+track+" ul.grid li[data-noteoff="+thisnote+"]").removeAttr("data-noteoff");
				$("#pattern"+pattern+" #track"+track+" li.lengthchange").last().attr("data-noteoff",thisnote);
				$("#pattern"+pattern+" #track"+track+" li.lengthchange").prop("class","");
			}
			if (paste) {
				if (typeof(lastnote[2])=="undefined") {
					lastnote[2]=100;
				}
				activestep.attr("data-notepitch",lastnote[0]);
				activestep.attr("data-notelength",lastnote[1]);
				activestep.attr("data-velocity",lastnote[2]);
				activestep.html(notenames[lastnote[0]%12]+parseInt(lastnote[0]/12));
			}
			active=0;
		}
	}
	else {
		activestep=$("#pattern"+pattern+" #track"+track+" #"+active);
	}
	if (active!=0) {
		/**
		* changing note pitches while playing is tricky.
		* you need to keep track of all the "note off" commands belonging to the note you're changing.
		* my solution to this: don't play any notes in the pitch the user is currently selecting 
		* this will avoid hanging notes, which would ruin a live performance
		*/
		if (d[1]==midiassign.setup_notepitch) {
			var nf=parseInt(noteoff+midichannel,2);
			var no=activestep.attr("data-notepitch");
			if (parseInt(no)>0) {
				midi_outputs["track"+track].send([nf,no,100]);
				/**
				* remove the noteoff command belonging to this note
				*/
				removeNoteOff(activestep);
			}

			activestep.attr("data-notepitch",d[2]);
			if (typeof(activestep.attr("data-notelength"))=="undefined") {
				activestep.attr("data-notelength",1);
			}
			activestep.next().attr("data-noteoff",d[2]);
			if (activestep.next().length<1) {
				activestep.parent().find("li:first").attr("data-noteoff",d[2]);
			}
			activestep.html(notenames[d[2]%12]+parseInt(d[2]/12));
			if (d[2]==0)
				activestep.html("-");
			lastnote=[activestep.attr("data-notepitch"),activestep.attr("data-notelength"),activestep.attr("data-velocity")];
		}
		/**
		* setting velocity is easier. :)
		*/
		if (d[1]==midiassign.setup_velocity) {
			activestep.attr("data-velocity",d[2]);
			lastnote=[activestep.attr("data-notepitch"),activestep.attr("data-notelength"),activestep.attr("data-velocity")];
		}
		/**
		* note fill function (e.g. for hihats)
		*/
		if (d[1]==midiassign.setup_notefill) {
			$("li.fill").prop("class","");
			var lc=activestep;
			lc.prop("class","fill");
			var notelength=Math.round(d[2]/8.5);
			for (var i=0;i<notelength;i++) {
				lc=lc.next();
				lc.prop("class","fill");
			}
		}
	}
	if (patternbutton&&d[1]==midiassign.setup_notepitch) {
		pattern_transpose_set(pattern,track,d[2]);
	}
	/**
	* start playback, create new web worker
	*/
	if (d[1]==midiassign.setup_play&&d[2]==127) {
		switchled([183,41,127]);
		playing=true;
		if(typeof(timer_worker)=="undefined"){
			timer_worker = new Worker('js/timer_task.js');
			timer_worker.addEventListener('message', function(e) {
				if (typeof(e.data.step)!="undefined") {
					playStep(e.data.step);
				}
			});
		}
		timer_worker.postMessage({'cmd':'bpm','bpm' : $("#bpm").html()});
		timer_worker.postMessage({'cmd' : 'swing','swing':$("#swing").html()});
		timer_worker.postMessage({'cmd' : 'start'});
	}
	/**
	* stop playback, global note off 
	*/
	if (d[1]==midiassign.setup_stop&&d[2]==127) {
		switchled([183,41,0]);
		playing=false;
		timer_worker.postMessage({'cmd' : 'stop'});
		ledoff();
		allnotesoff('stopbutton');
	}
	/**
	* adjust tempo
	*/
	if (d[1]==midiassign.setup_tempo) {
		$("."+'bpm').html(d[2]+60);
		if (typeof(timer_worker)!="undefined"&&timer_worker!=null)
			timer_worker.postMessage({'cmd':'bpm','bpm' : $("#bpm").html(),'swing':$("#swing").html()});
	}
	/**
	* adjust swing
	*/
	if (d[1]==midiassign.setup_swing) {
		$("."+'swing').html(Math.round((100/127)*d[2]));
		if (typeof(timer_worker)!="undefined"&&timer_worker!=null)
			timer_worker.postMessage({'cmd':'swing','swing' : $("#swing").html()});
	}
	/**
	* adjust note length
	*/
	if (d[1]==midiassign.setup_notelength) {
		$("li.lengthchange").prop("class","");
		var lc=activestep;
		lc.prop("class","lengthchange");
		var notelength=Math.round(d[2]/8.5);
		for (var i=0;i<notelength;i++) {
			lc=lc.next();
			lc.prop("class","lengthchange");
		}
		activestep.attr("data-notelength",notelength);
	}
	/**
	* paste button
	*/
	if (d[1]==midiassign.setup_copy) {
		paste=false;
		if (d[2]==127) {
			paste=true;
		}
	}
	/**
	* clear button
	*/
	if (d[1]==midiassign.setup_clear) {
		clear();
	}
	/**
	* change tracks, create new track, change patterns, create new patterns
	*/
	if (trackselectors.indexOf(d[1])>-1) {
		if (change_pattern) {
			if (d[2]>0) {
				var paindex=trackselectors.indexOf(d[1]);
				/**
				* let's clone the whole pattern :-)
				*/
				if ($("#pattern"+paindex).length<1) {
					var clone=$("#pattern"+pattern).clone();
					$(clone).find("h1").html("Pattern "+(paindex+1));
					$(clone).prop("id","pattern"+(paindex));
					$("#pattern"+pattern+" .track").each(function() {
						$(clone).find("#track"+$(this).attr("data-tracknumber")+" #device option").removeProp("selected");
						$(clone).find("#track"+$(this).attr("data-tracknumber")+" #device option[value="+$(this).find("#device").val()+"]").prop("selected","selected");
					});
					$("#song").append(clone);
				}
				$("div.pattern").css("display","none");
				$("#pattern"+paindex).css("display","block");
				init_outputselectors(paindex);
				$("#pattern"+paindex+" #device").each(function() {
					$(this).trigger("change");
				});
				if (playing) {
					nextpattern.push(paindex);
					$(".queue").html("<b>"+nextpattern.join("</b> <b>")+"</b>");
				}
				else {
					pattern=paindex;
				}
			}
			switchled([183,80,0]);
		}
		else {
			var trindex=trackselectors.indexOf(d[1]);
			if (paste&&typeof(trindex)!="undefined"&&d[2]>0) {
				if ($("#pattern"+pattern+" #track"+trindex).attr("class")=="track") {
					$("#pattern"+pattern+" #track"+trindex).attr("class","track mute");
				} else {
					$("#pattern"+pattern+" #track"+trindex).attr("class","track");
				}
			}
			else {
				if (d[2]>0) {
					patternbutton=true;
					if ($("#pattern"+pattern+" #track"+trindex).length<1) {
						var clone=$("#pattern"+pattern+" #track0").clone();
						$(clone).attr("data-tracknumber",trindex);
						$(clone).find("h2").html("Track "+(trindex+1));
						$(clone).prop("id","track"+(trindex));
						$("#pattern"+pattern).append(clone);
					}
					$("#pattern"+pattern+">div").css("display","none");
					$("#pattern"+pattern+" #track"+trindex).css("display","block");
					init_outputselectors(trindex);
					$("#pattern"+pattern+" #track"+trindex+" #device").trigger("change");
				}
				else {
					patternbutton=false;
				}
				track=trindex;
				switchled([183,80,0]);
			}
			trackledon();
		}
	}
	/**
	* pressing the pattern button toggles pattern select/create mode
	*/
	if (d[1]==midiassign.setup_pattern) {
		if(d[2]>0)
			change_pattern=true;
		else
			change_pattern=false;
		trackledon();
	}
	if (d[2]==0) {
		if (transpose.length>0) {
			pattern_transpose();
		}
		$("#pattern"+pattern+" #track"+track+" ul.grid li").removeAttr("data-noteoff");
		var c=0;
		$("#pattern"+pattern+" #track"+track+" ul.grid li").each(function() {
			if (typeof($(this).attr("data-notelength"))!="undefined") {
				var fw=c+parseInt($(this).attr("data-notelength"))+2;
				if (fw>16)
					fw=1;
				$("#pattern"+pattern+" #track"+track+" ul.grid li:nth-of-type("+fw+")").attr("data-noteoff",$(this).attr("data-notepitch"));
			}
			c++;
		});
	}
}

function showchangelog() {
	$("#changelog").fadeToggle();
}

/**
* set up a MIDI event handler
*/
function startLoggingMIDIInput( midiAccess, indexOfPort )
{
	midiAccess.inputs.forEach( function(entry) {entry.onmidimessage = onMIDIMessage;});
}

/**
* turn on/off an led
*/
function switchled(ar){
	if (typeof(ledtarget)!="undefined") {
		ledtarget.send(ar);
	}	
}

/**
* toggle midi learning
*/
function toggleMidiLearning() {
	if (!midilearn) {
		$('#setup').slideDown();
		$("#setup #setup_notepitch").focus();
		midilearn=true;
	}
	else {
		midilearn=false;
		$("p.youre_new").css("display","none");
		$('#setup').slideUp();
	}
}

/**
* will switch on the current track led
*/
function trackledon() {
	for (var i=0;i<trackselectors.length;i++) {
		switchled([183,trackselectors[i],0]);
	}
	if (change_pattern)
		switchled([183,trackselectors[pattern],127]);
	else
		switchled([183,trackselectors[track],127]);
}

/**
* jquery stuff - start and set up the sequencer once the page has loaded
*/
$(document).ready(function() {
	navigator.requestMIDIAccess().then( onMIDISuccess, onMIDIFailure );
	$("#inputdevice").on("change",function() {
		localStorage.setItem('inputdevice', $(this).val());
		setLEDDevice();
	});
	init_outputselectors();
	$("#channel").on("change",function() {
		localStorage.setItem('channel', $(this).val());
		midichannel=$(this).val();
	});
	if (typeof(localStorage.channel)!="undefined") {
		$("#channel option[value='"+localStorage.channel+"']").attr('selected','selected');
		$('#channel').trigger('change');
	}
	if (typeof(localStorage.midiassignments)!="undefined") {
		midiassign=JSON.parse(localStorage.midiassignments);
		var c=0;
		var t=0;
		$.each(midiassign, function(key,value){
			$("#"+key).val(value);
			if (key.indexOf("step")>0) {
				c=parseInt(key.replace("setup_step",""));
				if (c<10)
					buttonassign[value]="b0"+key.replace("setup_step","");
				else
					buttonassign[value]="b"+key.replace("setup_step","");
				ledorder[c]=value;
			}
			if (key.indexOf("track")>0) {
				trackselectors[t]=parseInt(value);
				t++;
			}
		});
	}
	if (trackselectors.length<1) {
		$("p.youre_new").css("display","block");
		$("p.youre_new").append("<br>");
		$("p.youre_new").append($("#track0 #inputdevice"));
		toggleMidiLearning();
	}
});