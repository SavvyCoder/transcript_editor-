var hour = 60 * 60;

function Select(config) {
  var select = this;

  this.videoWidth = config.videoWidth || 768;
  this.videoHeight = config.videoHeight || 432;

  this.wrapper = config.wrapper;
  this.currentTimeElement = $(".dev-current-time");
  this.video = $("#select-video");
  this.scrubContainer = $('#scrubWrapper');
  this.start = $('#select-start');
  this.finish = $('#select-finish');
  this.startHandle = $('#select-start-handle');
  this.startHandleTime = this.startHandle.find("span");
  this.finishHandle = $('#select-finish-handle');
  this.finishHandleTime = this.finishHandle.find("span");

  this.transcriptURL = config.transcriptURL;
  this.transcript;

  this.thumbnailSpriteURL = config.spriteURL;
  this.videoLevelsURL = config.levelsURL;
  this.previewURL = config.previewURL;
  this.previewThumbURL = config.previewThumbURL;

  this.mediaItem = JSON.parse(JSON.stringify(config.mediaItem));
  this.addSelect = config.addSelect;

  this.isSpriteLoaded = false;
  this.isPlayerLoaded = false;
  this.scrubberInited = false;
  this.scrubThumbView;
  this.scrubTime = 0;

  this.thumbWidth = 240;
  this.thumbHeight = 135;
  this.numberOfThumbs = 50;
  this.thumbsToUse = 25;
  this.percentOfThumb = 0.30;
  this.thumbSliceWidth = this.thumbWidth * this.percentOfThumb;
  this.thumbOffset = (this.thumbWidth - this.thumbSliceWidth)/2;
  this.spriteSegmentWidth = (this.thumbWidth * this.percentOfThumb) * this.numberOfThumbs;
  this.levels = [];
  this.waveform;
  this.selectStartTime = 0;
  this.selectFinishTime = 0;

  this.scrubSpeed = 0;
  this.scrubThread;

  this.panningright = false;
  this.panningleft = false;

  this.selectPlay = 0;
  this.wasPlaying = false;

  this.video.attr("poster", this.previewThumbURL);


  // Canvas Context for sprites
  this.context;
  this.thumbSprite = new Image();

  this.thumbSprite.addEventListener("load", function(event) {
    console.log("Sprite Image Loaded...");
    select.isSpriteLoaded = true;
    select.initScrubber();
  }, true);
  this.thumbSprite.src = this.thumbnailSpriteURL;
  this.video = $("<video id='select-video' class='video-js vjs-default-skin vjs-16-9' width='768' height='432' allowsInlineMediaPlayback playsinline webkit-playsinline></video>");
  this.wrapper.prepend(this.video);
  this.playerLoaded = false;
  this.player = videojs('select-video', {"fluid": true, "autoplay": true, "poster": this.previewThumbURL, "sources": [{ src: this.previewURL, type: 'video/mp4' }] }, function() {
    console.log("VideoJS initialized");
    console.log(select.wrapper);
    console.log("Video " + select.wrapper.width() + "x" + select.wrapper.height())
    select.videoWidth = select.wrapper.width();
    select.videoHeight = select.wrapper.height();
    this.on("timeupdate", function() {
      console.log("VideoJS timeupdated");
      if(select.selectPlay > 0 && this.currentTime() >= select.selectPlay) {
        select.selectPlay = 0;
        this.pause();
      }
      select.scrubTime = select.player.currentTime();
      select.currentTimeElement.text(select.formatTime(select.scrubTime));
      select.rebuildThumbScrub();
      select.waveform.redraw();

      if(select.transcript) {
        var line = $("#transcript .line").filter(function() {
            return select.player.currentTime() > $(this).attr("data-s")/1000  && select.player.currentTime() < $(this).attr("data-e")/1000;
        });
        if(line.length > 0) {
            $("#transcript .word").removeClass("selected");
            var word = line.find(".word").filter(function () {
                return select.player.currentTime() > $(this).attr("data-s")/1000  && select.player.currentTime() < $(this).attr("data-e")/1000;
            });
            word.addClass("selected");

            updateTranscriptScroll($(line[0]));
        }
      }
    });
    console.log("creating scrubthumbview");
    select.scrubThumbView  = $("<div id='scrubThumbView' style='position:absolute;top:0;left:0;width:100%;height:100%;background-image: url(\"" + select.thumbnailSpriteURL + "\");background-position: 0px 50%;background-size: 100%;display:none;'></div>");
    $("#select-video").append(select.scrubThumbView);
    console.log("Done creating scrubthumbview");

    if(this.readyState() < 1) {
      this.on('loadedmetadata', function() {
        select.onLoadedPlayerMetadata();
      });
    } else {
      select.onLoadedPlayerMetadata();
    }

    this.on("play", function(e) {
      $(".play-state-text").text("Pause");
      $(".svg-pause-icon").show();
      $(".svg-play-icon").hide();
    });

    this.on("pause", function(e) {
      $(".play-state-text").text("Play");
      $(".svg-pause-icon").hide();
      $(".svg-play-icon").show();
      select.selectPlay = 0;
    });
  });

  this.previewUpdateThread = setInterval(function () {
    $.get("/ajax?action=getReelmakerAssetDetails&assetid=" + select.mediaItem.id, function(data) {
			var media = data.asset;
			select.player.src(media.previewURL);
      select.player.pause();
		}, "json");
  }, (1000*60*30));

  if(this.transcriptURL) this.initTranscript();

  this.windowResize = function(event) {

    select.videoWidth = select.wrapper.width();
    select.videoHeight = select.wrapper.height();
    select.rebuildThumbScrub();

    select.waveform.update({
      data: select.levels,
      width: select.videoWidth,
      height: select.context.canvas.height * 0.9
    });
  };
  $(window).resize(this.windowResize);

  var startTouchHandle = new Hammer(this.startHandle[0], { multiUser: true });
  startTouchHandle.on("panright panleft", function(event) {
    var selectStartOffset = Math.min(event.center.x - select.scrubContainer.offset().left, select.finishHandle.offset().left - select.scrubContainer.offset().left - 4)/select.scrubContainer.width();
    select.setStart(Math.max(0, selectStartOffset * select.player.duration()), true);
  });
  var finishTouchHandle = new Hammer(this.finishHandle[0], { multiUser: true });
  finishTouchHandle.on("panright panleft", function(event) {
    var selectFinishOffset = Math.max((event.center.x - select.scrubContainer.offset().left), select.startHandle.offset().left - select.scrubContainer.offset().left + 8)/select.scrubContainer.width();
    //var percentOffsetForDragHandle = ((select.scrubContainer.width() - 4)/select.scrubContainer.width());
    select.setFinish(Math.min(1, selectFinishOffset) * select.player.duration(), true);
  });

}

Select.prototype.remove = function() {
  try {
    this.touchSB.off("tap").destroy();
    $(window).off("resize", this.windowResize);
  } catch(err) {
    console.log("Problems destroying save select button touch.");
    console.log(err);
  }

  try {
    this.scrubContainer.find("#audio-levels").empty();
  } catch(err) {
    console.log("Problems destorying audio levels.");
    console.log(err);
  }
  try {
    if(this.scrubThumbView) this.scrubThumbView.remove();
  } catch(err) {
    console.log("Problems destorying thumb scrubber.");
    console.log(err);
  }
  try {
    if(this.player) this.player.dispose();
  } catch(err) {
    console.log("Problems destorying select player.");
    console.log(err);
  }

  try {
    if(this.previewUpdateThread) clearInterval(this.previewUpdateThread);
  } catch(err) {
    console.log("Problems clearing preview video update interval.");
    console.log(err);
  }

  select = {};
  $("#overlay").empty();
}

Select.prototype.initControls = function() {
  var select = this;
  var controls = $("#controls");

  $("#vol-control").on("change mousemove", function() {
    select.player.volume($(this).val()/100);
  });

  var playButton = controls.find(".video-play");
  var touchPlay = new Hammer(playButton[0], { multiUser: true });
  touchPlay.on("tap", function(event) {
    if(select.player.paused()) {
      select.player.play();
    } else {
      select.player.pause();
    }
  });

  var ffButton = controls.find(".video-step-forward");
  var touchFF = new Hammer(ffButton[0], { multiUser: true });
  touchFF.on("tap", function(event) {
    var totalTime = select.player.duration();
    var newTime = select.player.currentTime() + 0.033;
    var forwardTime = Math.min(newTime, totalTime);
    console.log("Frame Forward - " + select.player.currentTime() + " --> " + forwardTime);
    select.player.pause().currentTime(forwardTime);
  });

  var fbButton = controls.find(".video-step-backward");
  var touchFB = new Hammer(fbButton[0], { multiUser: true });
  touchFB.on("tap", function(event) {
    var totalTime = select.player.duration();
    var newTime = select.player.currentTime() - 0.033;
    var forwardTime = Math.min(newTime, totalTime);
    var backTime = Math.max(newTime, 0);
    console.log("Frame Backward - " + select.player.currentTime() + " --> " + backTime);
    select.player.pause().currentTime(backTime);
  });

  var siButton = controls.find(".video-set-in-point");
  var touchSI = new Hammer(siButton[0], { multiUser: true });
  touchSI.on("tap", function(event) {
    var newInPoint = select.player.currentTime();
    if(newInPoint > select.selectFinishTime) select.setFinish(Math.min(select.player.duration(), newInPoint + 3), false);
    select.setStart(newInPoint, true);
  });
  var soButton = controls.find(".video-set-out-point");
  var touchSO = new Hammer(soButton[0], { multiUser: true });
  touchSO.on("tap", function(event) {
    var newOutPoint = select.player.currentTime();
    if(newOutPoint < select.selectStartTime) select.setStart(Math.max(0, newOutPoint - 3), false);
    select.setFinish(select.player.currentTime(), true);
  });

  var previewButton = controls.find(".video-preview");
  var touchPB = new Hammer(previewButton[0], { multiUser: true });
  touchPB.on("tap", function(event) {
    select.selectPlay = select.selectFinishTime;
    select.player.currentTime(select.selectStartTime).play();
  });

  var saveButton = controls.find(".video-save");
  select.touchSB = Hammer(saveButton[0]);
  select.touchSBCallback = function(event) {
    console.log("Saving select....");
    // This is taking too long to confirm...would rather confirm that the select is added and backfill the thumbnail ASAP
    // Generate thumbnail and then save the select
    $.get("/ajax?action=generateReelmakerSelectThumb&hostedid=" + select.mediaItem.hostedid + "&t=" + select.selectStartTime, function(data) {
      console.log("Got Select Thumb: ");
      console.log(data);
      select.mediaItem.mthumb = data.trim();
      console.log(select)
      select.addSelect(select.mediaItem, select.selectStartTime, select.selectFinishTime);
      $("#select-created-dialog").modal('show');
    });
  };
  select.touchSBKeys = "tap";
  select.touchSB.on(select.touchSBKeys, select.touchSBCallback);

  var closeButton = $(".dev-close-select-dialog");
  var touchCS = new Hammer(closeButton[0], { multiUser: true });
  touchCS.on("tap", function(event) {
    console.log("Close Select Dialog");

    //Hammer.off(saveButton[0],"tap", touchSBCallback);
    $("#overlay").hide();
    select.remove();
  });

  select.initVideoTouch();
}

Select.prototype.initTranscript = function() {
  var select = this;
  console.log("Init Transcript");
  $.getJSON(this.transcriptURL).done(function(data) {
    select.transcript = data;
    console.log("Got Transcript...");
    console.log(data);
    initInteractiveTranscript(select);
  });
}

Select.prototype.onLoadedPlayerMetadata = function() {
  if(this.playerLoaded == false) {
    this.playerLoaded = true;
    console.log("VideoJS metadata loaded");
    this.player.pause();
    this.isPlayerLoaded = true;
    this.initControls();
    this.initScrubber();
    this.initWaveform();
    var tooltips = $('#overlay [data-toggle="tooltip"]');
    console.log("Tooltips init...");
    console.log(tooltips);
    tooltips.tooltip({placement: 'top',trigger: 'manual'}).tooltip('show');


    this.setFinish(this.player.duration(), false);
    this.setStart(0, true);
  }
}

Select.prototype.initWaveform = function() {
  var select = this;
  $.getJSON(this.videoLevelsURL).done(function(alj) {
    console.log("Got json data...");
    var left = alj.left;
    var right = alj.right;
    select.levels = [];
    for(var i = 0; i < left.length; i++) {
      var ave = (left[i] + right[i])/2;
      //console.log("Average Level @ Frame: " + i + " [" + left[i] + "," + right[i] + "] = " + ave);
      select.levels.push(ave);
    }
  }).always(function() {
    select.waveform = new Waveform({
      container: select.scrubContainer.find("#audio-levels")[0],
      data: select.levels,
      height: select.context?select.context.canvas.height * 0.9:50,
      innerColor: function(x, y){
        //console.log("innercolor: " + x + "," + y);
        if(x < select.scrubTime/select.player.duration()) {
          return '#e80d18';
        } else {
          return '#fff';
        }
      }
    });

    var wf = new Hammer(select.waveform.context.canvas, { multiUser: true });
    wf.on("tap", function(event) {
      var bb = event.target.getBoundingClientRect();
      var position = (event.center.x - bb.left)/event.target.clientWidth * select.player.duration();
      select.scrubTime = position;
      select.rebuildThumbScrub();
      select.waveform.redraw();
      select.player.currentTime(position);
      /*if(select.player.paused()) {
        select.player.play();
      } else {
        select.player.pause();
      }*/
    });
    wf.on("panright panleft", function(event) {
      if(!select.player.seeking()) {
        var bb = event.target.getBoundingClientRect();
        select.scrubTime = (event.center.x - bb.left)/event.target.clientWidth * select.player.duration();
        //player.currentTime(position);
        var position = Math.round((event.center.x - bb.left)/event.target.clientWidth * select.numberOfThumbs);
        select.wasPlaying = !select.player.paused();
        select.player.pause();
        select.scrubThumbView.css("background-position", "0 " + position*2 + "%");
        select.scrubThumbView.show();
        select.rebuildThumbScrub();
        select.waveform.redraw();
      }
    });

    wf.on("panend", function(event) {
      var bb = event.target.getBoundingClientRect();
      var position = (event.center.x - bb.left)/event.target.clientWidth * select.player.duration();
      select.scrubTime = position;
      select.scrubThumbView.hide();
      select.rebuildThumbScrub();
      select.waveform.redraw();

      select.player.currentTime(position);
      if(select.wasPlaying == true) select.player.play();
    });

    select.rebuildThumbScrub();
  });
}

Select.prototype.initScrubber = function() {
  if(this.isPlayerLoaded && this.isSpriteLoaded && !this.scrubberInited) {
    console.log("Initializing Scrubber...");
    var select = this;
    this.scrubberInited = true;
    var canvas = document.getElementById("imagescrub");
    canvas.width = this.wrapper.width();
    canvas.height = this.wrapper.width()/9;
    this.context = canvas.getContext("2d");

    this.thumbSprite = this.buildSlicedImage();

    this.windowResize();

    //this.rebuildThumbScrub();

    var st = new Hammer(this.context.canvas, { multiUser: true });
    st.on("tap", function(event) {
      var bb = event.target.getBoundingClientRect();
      var position = (event.center.x - bb.left)/event.target.clientWidth * select.player.duration();
      select.scrubTime = position;
      select.player.currentTime(position);
      select.rebuildThumbScrub();
      select.waveform.redraw();
      //select.player.play();
    });
    st.on("panright panleft", function(event) {
      if(!select.player.seeking()) {
        var bb = event.target.getBoundingClientRect();
        select.scrubTime = (event.center.x - bb.left)/event.target.clientWidth * select.player.duration();
        //player.currentTime(position);
        var position = Math.round((event.center.x - bb.left)/event.target.clientWidth * select.numberOfThumbs);
        select.wasPlaying = !select.player.paused();
        select.player.pause();
        select.scrubThumbView.css("background-position", "0 " + position*2 + "%").show();
        select.rebuildThumbScrub();
        select.waveform.redraw();
        //player.play();
      }
    });

    st.on("panend", function(event) {
      var bb = event.target.getBoundingClientRect();
      var position = (event.center.x - bb.left)/event.target.clientWidth * select.player.duration();
      select.scrubThumbView.hide();
      select.player.currentTime(position);
      select.rebuildThumbScrub();
      select.waveform.redraw();
      if(select.wasPlaying) select.player.play();
    });

    if(this.waveform) {
      this.waveform.update({
        data: this.levels,
        width: this.videoWidth,
        height: this.context.canvas.height * 0.9,
      });
    }
  }
}

Select.prototype.buildSlicedImage = function() {
  var offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = this.thumbSliceWidth * this.thumbsToUse;
  offscreenCanvas.height = this.thumbHeight;
  var offScreenContext = offscreenCanvas.getContext("2d");
  console.log("Building full size thumb slice: " + offscreenCanvas.width + "x" + offscreenCanvas.height);
  for(i = 0; i < this.numberOfThumbs; i++) {
    //console.log("Building slice: " + i + " - " + thumbSliceWidth + "x" + thumbHeight);
    offScreenContext.drawImage(this.thumbSprite, 0, this.thumbHeight * (i*2), this.thumbSliceWidth, this.thumbHeight, i*this.thumbSliceWidth, 0, this.thumbSliceWidth, this.thumbHeight);
  }
  return offscreenCanvas;
}

/*Select.prototype.formatTime = function(seconds) {
  var time = "";
  if(seconds > hour) {
    hours = Math.floor(seconds/hour);
    time += ((hours>9)?hours:"0"+hours) + ":";
    seconds -= hours * hour;
  } else time += "00:";

  if(seconds > 60) {
    minutes = Math.floor(seconds/60);
    time += ((minutes>9)?minutes:"0"+minutes) + ":";
    seconds -= minutes * 60;
  } else time += "00:";
  seconds = Math.ceil(seconds);
  time += ((seconds>9)?seconds:"0"+seconds);

  return time;
  return videojs.formatTime(seconds);
}*/

Select.prototype.setStart = function(startTime, movePlayhead) {
  if(startTime >= this.selectFinishTime) {
    startTime = Math.max(this.selectFinishTime - 0.033, 0);
  }
  this.selectStartTime = startTime;
  var percent = (startTime/this.player.duration()) * 100;
  this.start.css('width', percent + "%");
  $(".select-length-formatted").html(this.formatTime(this.selectFinishTime - this.selectStartTime));
  var formattedStartTime = this.formatTime(this.selectStartTime);
  $(".select-start-formatted").html(formattedStartTime);
  console.log("set select start to: " + this.selectStartTime);
  //startHandleTime.attr("data-original-title", formattedStartTime).tooltip('show');
  this.startHandle.find(".tooltip-inner").text(formattedStartTime);
  if(movePlayhead) this.player.currentTime(startTime);
}

Select.prototype.setFinish = function(finishTime, movePlayhead) {
  if(finishTime <= this.selectStartTime) {
    finishTime = Math.min(this.selectStartTime + 0.033, this.player.duration());
  }
  this.selectFinishTime = finishTime;
  var fraction = finishTime/this.player.duration();
  var percent = fraction * 100;
  var width = (this.scrubContainer.width() - (this.scrubContainer.width() * fraction)) + 4;
  var widthPercent = width/this.scrubContainer.width() * 100;

  var left = this.scrubContainer.width() * fraction - 4;
  var leftPercent = left/this.scrubContainer.width() * 100;

  console.log("Left: " + leftPercent + " Width: " + widthPercent);

  this.finish.css('width', widthPercent + "%");
  this.finish.css('left', leftPercent + "%");
//  this.finish.css('width', (100 - percent) + "%");
//  this.finish.css('left', (percent) + "%");
  $(".select-length-formatted").html(this.formatTime(this.selectFinishTime - this.selectStartTime));
  var formattedFinishTime = this.formatTime(this.selectFinishTime);
  $(".select-finish-formatted").html(formattedFinishTime);
  console.log("set select finish to: " + this.selectFinishTime);
  //finishHandleTime.attr("data-original-title", formattedFinishTime).tooltip('show');
  this.finishHandle.find(".tooltip-inner").text(formattedFinishTime);

  if(movePlayhead) this.player.currentTime(finishTime);

  if(this.selectPlay > 0) {
    this.selectPlay = finishTime;
  }
}

Select.prototype.rebuildThumbScrub = function() {

  if(this.context)  {
    console.log("Rebuilding thumb scrub view....");
    this.context.clearRect(0, 0, this.context.canvas.width, this.context.canvas.height);
    this.context.canvas.width = this.videoWidth;
    //var sliceWidth = this.context.canvas.width/this.thumbsToUse;
    //var desiredHeight = this.videoHeight/10;
    //var thumbSliceWidth = desiredHeight *

    //console.log("TH: " + this.thumbHeight + " SW: " + sliceWidth + " TSW: " + this.thumbSliceWidth);
    //this.context.canvas.height = this.thumbHeight * (sliceWidth/this.thumbSliceWidth);
    this.context.canvas.height = (this.context.canvas.width/this.thumbSprite.width) * this.thumbSprite.height;

    this.context.drawImage(this.thumbSprite, 0, 0, this.videoWidth, this.context.canvas.height);

    var x = this.context.canvas.width * (this.scrubTime/this.player.duration());

    var offset = Math.max(x, 1.5);
    offset = Math.min(offset, this.context.canvas.width);

    this.context.moveTo(offset, 0);
    this.context.lineTo(offset, this.context.canvas.height);
    this.context.lineWidth = 3;
    this.context.strokeStyle = "#4885D7";
    this.context.stroke();
    console.log("Done Rebuilding thumb scrub view....");
    $("#transcript").height($("#select-video video").height() + $("#scrubWrapper").height() - 35 - $(".transcript-search-box").height());
  } else {
    console.log("No context to rebuilding scrubber.");
  }

}


Select.prototype.initVideoTouch = function() {
  var select = this;
  var mc = new Hammer(this.video[0], { multiUser: true });
  mc.get('swipe').set({ direction: Hammer.DIRECTION_ALL });

  // listen to events...
  mc.on("swipeleft", function(event) {
    var totalTime = select.player.duration();
    var newTime = select.player.currentTime() - .033;
    var totalFrames = Math.ceil(totalTime*30);
    var newFrame = Math.ceil(newTime*30);
    var forwardTime = Math.min(newTime, totalTime);
    var backTime = Math.max(newTime, 0);
    select.player.pause().currentTime(backTime);
  });
  mc.on("swiperight", function(event) {
    var totalTime = select.player.duration();
    var newTime = select.player.currentTime() + .033;
    var totalFrames = Math.ceil(totalTime*30);
    var newFrame = Math.ceil(newTime*30);
    var forwardTime = Math.min(newTime, totalTime);
    select.player.pause().currentTime(forwardTime);
  });
  mc.on("swipeup", function(event) {
    select.setStart(select.player.currentTime(), true);
  });
  mc.on("swipedown", function(event) {
    select.setFinish(select.player.currentTime(), true);
  });

  mc.on("tap", function(event) {
    if(select.player.paused()) {
      select.player.play();
    } else {
      select.player.pause();
    }
  });


  mc.on("panright", function(event) {
    if(event.deltaTime > 200) {
      if(!select.panningright && !select.panningleft) select.startScrub();
      if(!select.panningleft) select.panningright = true;
      select.pan(event.deltaX);
    }
  });

  mc.on("panend", function(event) {
    if(select.panningleft || select.panningright) {
      select.panningright = false;
      select.panningleft = false;
      clearInterval(select.scrubThread);
      //playbackRate = 1;
      select.scrubSpeed = 0;
      select.player.play();
    }
  });

  mc.on("panleft", function(event) {
    if(event.deltaTime > 200) {
      if(!select.panningright && !select.panningleft) select.startScrub();
      if(!select.panningright) select.panningleft = true;
      select.pan(event.deltaX);
    }
  });
}

Select.prototype.startScrub = function() {
  var select = this;
  clearInterval(this.scrubThread);
  //console.log("starting scrub thread.");
  this.scrubThread = setInterval(function() {
    //console.log("still in scrub thread...");
    if((select.panningright || select.panningleft) && !select.player.seeking()) {
      var currentTime = select.player.currentTime();
      var setTime = Math.max(currentTime + (.033 * select.scrubSpeed), 0);
      //console.log("setting player current time: " + currentTime + " + " + (select.scrubSpeed * .033) + " = " + setTime + " - update: " + new Date().getTime());
      select.player.currentTime(setTime);
    }
  }, 33.33);
}


Select.prototype.pan = function(distance) {
  this.scrubSpeed = Math.ceil(distance/5);
  var scrubIndicator = Math.abs(this.scrubSpeed);
  var fps = scrubIndicator/30;
  console.log("fps: " + fps);
  if(fps > 1) {
    scrubIndicator = ((Math.round(fps*2)) / 2).toFixed(1);
  } else if(fps >= .1) {
    scrubIndicator = fps.toFixed(1);
  } else {
    scrubIndicator = fps.toFixed(2);
  }
  //player.playbackRate(scrubSpeed);
  if(distance > 0) {
    //logs.html("<h4>Fast Forward " + scrubIndicator + "x</h4>");
  } else {
    //logs.html("<h4>Fast Rewind " + scrubIndicator + "x</h4>");
  }

}

Select.prototype.formatTime = function(seconds, guide) {
  // Default to using seconds as guide
  guide = guide || seconds;
  var rs = Math.round(seconds*1000)/1000;
  var //ms = Math.round(rs * 1000),
      millis = Math.round((rs - Math.floor(rs)) * 1000 ),
      fs = rs % 60,
	  s = Math.floor(fs),
      m = Math.floor(rs / 60 % 60),
      h = Math.floor(rs / 3600),
      gm = Math.floor(guide / 60 % 60),
      gh = Math.floor(guide / 3600);

  // handle invalid times
  if (isNaN(seconds) || seconds === Infinity) {
    // '-' is false for all relational operators (e.g. <, >=) so this setting
    // will add the minimum number of fields specified by the guide
    h = m = s = '-';
  }

  // Check if we need to show hours
  h = (h > 0 || gh > 0) ? h + ':' : '';

  // If hours are showing, we may need to add a leading zero.
  // Always show at least one digit of minutes.
  m = (((h || gm >= 10) && m < 10) ? '0' + m : m) + ':';

  // Check if leading zero is need for seconds
  s = (s < 10) ? '0' + s : s;

  s = s + '.' + millis.toFixed().padTimestamp(3, "0");

  return h + m + s;
};

String.prototype.padTimestamp = function(l, s){
	return (l -= this.length) > 0 ? (s = new Array(Math.ceil(l / s.length) + 1).join(s)).substr(0, s.length) + this + s.substr(0, l - s.length) : this;
};

function renderWaveform(data,plain,clear){
  if(data){
      //console.log("rendering waveform data: " + data);
      for(var i = 0; i < data.length; i++){

          plain = plain || 2;
          clear = clear || 1;
          var step = plain+clear;
          if (i % step == 0){
              var sum=0;
              for (var j = 0; j < plain; j++) {
                  sum += data[i+j];
              };
              var average = (sum/plain);
              for (var j = 0; j < plain; j++) {
                  data[i+j]=average;
              };
              for (var j = plain; j < step; j++) {
                  data[i+j]=0;
              };
          }
      }
      return data;
  } else {
      return;
  }
}

Waveform.prototype.redraw = function() {
  var d, i, t, _i, _len, _ref, _results;
  this.clear();
  if (typeof this.innerColor != "function") {
    this.context.fillStyle = this.innerColor;
  }
  i = 0;
  _ref = this.data;
  //console.log(this.data);
  var containerWidth = $(this.container).width();
  _results = [];
  for (_i = 0, _len = _ref.length; _i < _len; _i++) {
    d = _ref[_i];
  //  console.log("data into canvas: " + containerWidth + " / "  + this.data.length);
    t = containerWidth / this.data.length;
    if (typeof this.innerColor === "function") {
      this.context.fillStyle = this.innerColor(i / containerWidth, d);
    }
    var barHeight = this.height * d * 1.9;
    //console.log(this.container);
    //console.log("redrawing waverform: " + i + "," + this.height + " - " + t + "x" + barHeight);
    this.context.fillRect(i, this.height, t, -barHeight);

    _results.push(i++);

  }
  return _results;
};

var scTimes = {
    start: 0,
    end: 0,
    firstWord: 0,
    lastWord: 0
}

var animating = false;
function updateTranscriptScroll(line) {
  var tDiv = $("#transcript");
  console.log("line offset: " + line.offset().top + " scrollTop: " + tDiv.scrollTop() + " position: " + line.position().top);
  var lineOffsetTop = line.offset().top - tDiv.offset().top + tDiv.scrollTop();
  var lineOffsetBottom = lineOffsetTop + line.height();
  var scrollMid = tDiv.height()/2 +  tDiv.scrollTop();
  var scrollBottom =  tDiv.scrollTop() + tDiv.height();
  // There might be large blanks of audio at beginning and end before first and last word, ignore them
  if(!animating) {
      //var midpoint = (scTimes.end - scTimes.start)/2;
      console.log("Checking: " + lineOffsetTop + " start: " + scrollTop + " mid: " + scrollMid + " end: " + scrollBottom);
      if(lineOffsetTop < tDiv.scrollTop() || lineOffsetBottom > scrollBottom) {
          console.log("Fast Scroll put text at top: " + lineOffsetTop);
          //console.log(currentLine);
          animating = true;
          tDiv.animate({
              scrollTop: lineOffsetTop
          }, {
              duration: 100,
              complete: function () {
                animating = false;
                console.log("auto scrolling complete");
              }
          });
          // animate to line
      } else if(lineOffsetTop >= scrollMid) {
          console.log("Hit middle: " + scrollMid + ", slow scroll up to: " + lineOffsetTop);
          //console.log(currentLine);
          animating = true;
          tDiv.animate({
              scrollTop: lineOffsetTop
          }, {
              duration: 2000,
              complete: function() {
                animating = false;
                console.log("auto scrolling complete");
              }
          });
      } else {
          //console.log("Player and transcript inline...");
      }
  }
  }

function initInteractiveTranscript(select) {

  var engine = new Bloodhound({
        name: 'transcript',
        limit: 99999,
        //local: $.map(transcript, function(sentence) { return { start: sentence.words[0].s, value: $.map(sentence.words, function(word) { return word.v }).join(" ") } }),
        local: $.map(select.transcript, function(sentence) {
            return {
                start: sentence.words[0].s,
                value: $.map(sentence.words, function(word) {
                    return word.v;
                }).join(" ")
            };
        }),
        datumTokenizer: function(d) {
            return Bloodhound.tokenizers.whitespace(d.value);
        },
        queryTokenizer: Bloodhound.tokenizers.whitespace
    });

    engine.initialize();

    $('#bloodhound .typeahead').typeahead({
        hint: true,
        highlight: true,
        minLength: 2
    },
    {
        name: 'engine',
        displayKey: 'value',
        // `ttAdapter` wraps the suggestion engine in an adapter that
        // is compatible with the typeahead jQuery plugin
        source: engine.ttAdapter()
    }).on('typeahead:selected', function (e, datum) {
        select.player.currentTime(datum.start/1000);
        select.player.play();
        $('#bloodhound .typeahead').typeahead('val', '');
    }).on('typeahead:cursorchanged', function (e, datum) {
        select.player.currentTime(datum.start/1000);
        select.player.play();
        select.player.pause();
        //$('#bloodhound .typeahead').typeahead('val', '');
    });
  $("#selectOverlayContents").addClass("transcript-container");
  $(".dev-select-player-column").removeClass("col-sm-10").addClass("col-sm-7");

  $(".select-grid-container").addClass("transcript");
  $(".fluid-video-container").addClass("transcript");

  $(".dev-select-transcription-column").show();


  var tDiv = $("#transcript");
  tDiv.height($("#select-video video").height() + $("#scrubWrapper").height() - 35 - $(".transcript-search-box").height());
  tDiv.empty();
    for(iSentence in select.transcript) {
        var sentence = select.transcript[iSentence];
        var line = $("<div class='line' data-s='" + sentence.words[0].s + "' data-e='" + sentence.words[sentence.words.length - 1].e + "'></div>");
        for(iWord in sentence.words) {
            var w = sentence.words[iWord];
            var word = $("<span class='word' data-s='" + w.s + "' data-e='" + w.e + "'>" + w.v + "</span>");
            line.append(word);
            word.click(function() {
                endSelection = -1;
                select.player.currentTime($(this).attr("data-s")/1000);
                select.player.play();
            });
        }
        tDiv.append(line);
    }

    scrollTop = tDiv.scrollTop();
    console.log("Setting Transcript Height to: " + $("#videowrapper").height());

    scrollHeight = tDiv.height();


    // We use this event to know when user is done selecting text
    // If the user lets their mouseup in a span it is trivial to find the node rage.
    // If the user lets their mouse up some place else in the div, we must use the selection to determine range
    // If the user mouseup is outside the div, we should reduce selection to only include nodes within the div
    tDiv.mouseup(function(e) {
        //selectMouseDown = false;
        //if(wordCountDiv) wordCountDiv.remove();
        var sel = rangy.getSelection();

        // Make sure that a range is selected
        if(sel.rangeCount) {
            // Get all of the nodes in the selection
            var range = sel.getRangeAt(0);
            var nodes = range.getNodes([1], function(el) {
                console.log(el);
                return el.tagName == "SPAN";
            });
            //console.log("Node length: " + nodes.length);
            if(nodes.length == 0) {
                // Check range to make sure we didn't have a single text node
                nodes = range.getNodes();
                if(nodes.length) {
                    // No element nodes, but we probably have a text node
                    if(nodes[0].nodeType = 3) {
                        nodes[0] = $(nodes[0]).parent()[0];
                    }
                    console.log(nodes);
                }
            }
            if(nodes.length) {
                var startTime = $(nodes[0]).attr("data-s")/1000;
                var endTime = $(nodes[nodes.length - 1]).attr("data-e")/1000;
                console.log("Select " + startTime + " - " + endTime);
                select.player.pause();
                // Need to reset select times so start/finish collision doesn't happen
                select.selectStartTime = 0;
                select.selectFinishTime  = select.player.duration();

                select.setStart(startTime, false);
                select.setFinish(endTime, false);


                select.player.currentTime(startTime);
                select.selectPlay = endTime;
                select.player.play();

                sel.removeAllRanges();
            }
        } else {
            console.log("No range.");
        }
    });
    select.rebuildThumbScrub();
    /*currentPlayer.play();
    currentPlayer.pause();

    scTimes.firstWord = $("#transcript .word:first").attr("data-s")/1000;
    scTimes.lastWord = $("#transcript .word:last").attr("data-e")/1000;

    console.log("First Word: " + scTimes.firstWord + " Last Word: " + scTimes.lastWord);*/
}
