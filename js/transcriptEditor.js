    // TRANSCRIPT EDITOR SCRIPT // 
    // ======================== //    
    
    //Start the video js player
    var transcriptPlayer = videojs('transcript_audio');
    
    //Create word object to hold words data
    function Word(word, start, end, type){
        this.word = word; 
        this.start = start;
        this.end = end;
        this.type = type; 
    }
    
    //word object array
    var words = []; 
    
    var number_of_words_per_line = 20; 
    
    var transcriptFilePath = "/transcripts/AliceInWonderlandInteractive.json";
    
    var audioFilePath = "/videos/wonderland_ch_12_64kb.mp3";
    
    transcriptPlayer.src(audioFilePath);
    
    //Output properly spaced file name to title header 
    $(function(){ 
        var transcriptName = transcriptFilePath.slice(transcriptFilePath.lastIndexOf("/") + 1, transcriptFilePath.lastIndexOf("."));
        transcriptName = transcriptName.replace(/([A-Z])/g, ' $1').trim();
        $(".box-title").text(transcriptName);
    });
    
    
    //Take json transcript as argument and push data to word object, then assign objects to array sequentially
    function convertTranscriptToWordObjectArray(transcript) {
        var wordsIndex = 0; 
        for(var i = 0; i < transcript.length; i++){
            for(var j = 0; j < transcript[i].words.length; j++){
               words[wordsIndex] = new Word(transcript[i].words[j].v, transcript[i].words[j].s, transcript[i].words[j].e, transcript[i].words[j].t); 
               wordsIndex++;
            }
        }
        return words; 
    }
    
    //Get json file and convert to word object then output each word to indivdual span elements and dynamically add spacing
    $.getJSON(transcriptFilePath, function(transcript) {
        console.log(convertTranscriptToWordObjectArray(transcript));
        var transcriptDiv = $("#transcript-container");
        var wordIndex = 0; 
        for (var i = 0; i < Math.ceil(words.length/number_of_words_per_line); i++){
            for(var j = 0; j < number_of_words_per_line; j++){
                if(wordIndex+1 < words.length) {
                    transcriptDiv.append($("<span contenteditable='true'></span>").text(words[wordIndex].word).attr('id', words[wordIndex].start).attr('class', "transcript-words").attr('name', wordIndex)); 
                    if(words[wordIndex+1].word == "," || words[wordIndex+1].word == "."){
                        wordIndex++;
                        continue; 
                    }
                    else {
                        transcriptDiv.append(" ");
                        wordIndex++;
                    }
                }
            }
            //transcriptDiv.append("<br><br>");
        }
    });
    
    //Add click listeners to each word-span to change player time to match word start time
    $(function() {
        $(".box-body").on('click','.transcript-words', function() {
            transcriptPlayer.currentTime(convertToSeconds($(this).attr('id')));
        });
    });
    
    //Check if player position has changed, then check if word start times are less than player position. Add/remove higlights accordingly. 
    $(function() {
        transcriptPlayer.on('timeupdate', function(){
            $(".transcript-words").each(function(){
            if(convertToSeconds($(this).attr("id")) <= transcriptPlayer.currentTime()){
                $(this).css('background', '#80ced6');
            }
            if(convertToSeconds($(this).attr("id")) > transcriptPlayer.currentTime()){
                $(this).css('background', '');
            }
            });
        });
    });
    
    //On leaving the word-span element, check if empty and if string has 3 or less words. If empty, fill with original content. If over 3, splice until 3 and fill element. 
    $(function() {
        $(".box-body").on('focusout','.transcript-words', function() {
            var str = $(this).text();
                if (str.split(" ").length > 3){
                    var newStr = str.split(" ").splice(0, 3).join(" ");
                    $(this).text(newStr);
                }
                else if(str == ""){
                    $(this).text(words[$(this).attr('name')].word);
                }
        });
    });
    
    //Take JSON transcript and update word content with modified content 
    function updateJsonTranscript(transcript){
        var sentenceIndex = 0; 
        var wordIndex = 0;
        $(".transcript-words").each(function(index){
            if(transcript[sentenceIndex].words.length <= wordIndex){
                sentenceIndex++;
                wordIndex = 0; 
            }
            transcript[sentenceIndex].words[wordIndex].v = $(this).text(); 
            wordIndex++;
        });
            return transcript; 
    }
    
    //updates JSON transcript and outputs JSON to console
    $("#save-transcript-changes").click(function(){
        $.getJSON(transcriptFilePath, function(transcript){
            console.log(updateJsonTranscript(transcript));
        });
    });
    
    //convert from milliseconds to seconds for player time
    function convertToSeconds(transcriptTime) {
        return transcriptTime/1000; 
    }
    