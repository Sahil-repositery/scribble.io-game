const wordsData = require("./words.json");

class Game {
  constructor(players, settings, onStateChange, onRoundEnd, onGameOver) {
    this.players = players; // Array of Player objects
    this.settings = settings; // settings: { maxPlayers, rounds, drawTime, wordCount, hintsCount, wordMode }
    this.onStateChange = onStateChange; // callback
    this.onRoundEnd = onRoundEnd; // callback
    this.onGameOver = onGameOver; // callback

    this.currentRound = 1;
    this.turnIndex = -1; // Index of the drawer in this.players
    this.drawerId = null;
    this.phase = "LOBBY"; // LOBBY, SELECTING_WORD, DRAWING, ROUND_END, GAME_OVER

    this.wordOptions = [];
    this.currentWord = "";
    this.hintString = "";
    this.revealedIndices = [];

    this.timeLeft = 0;
    this.timerInterval = null;
    this.correctGuessesCount = 0;
  }

  start() {
    this.currentRound = 1;
    this.turnIndex = -1;
    this.nextTurn();
  }

  destroy() {
    this.stopTimer();
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  startTimer(duration, onComplete) {
    this.stopTimer();
    this.timeLeft = duration;
    this.onStateChange();

    this.timerInterval = setInterval(() => {
      this.timeLeft--;
      
      // Handle mid-round hint reveals
      if (this.phase === "DRAWING") {
        this.checkHintReveal();
      }

      this.onStateChange();

      if (this.timeLeft <= 0) {
        this.stopTimer();
        onComplete();
      }
    }, 1000);
  }

  nextTurn() {
    this.stopTimer();
    
    // Filter active players (players who are still connected)
    const activePlayers = this.players.filter(p => p.socketId);
    if (activePlayers.length < 2) {
      this.endGame();
      return;
    }

    // Reset player round states
    this.players.forEach(p => p.resetRoundState());
    this.correctGuessesCount = 0;

    this.turnIndex++;
    if (this.turnIndex >= this.players.length) {
      this.turnIndex = 0;
      this.currentRound++;
    }

    // Check if game has finished all rounds
    if (this.currentRound > this.settings.rounds) {
      this.endGame();
      return;
    }

    const currentDrawer = this.players[this.turnIndex];
    this.drawerId = currentDrawer.socketId;
    this.phase = "SELECTING_WORD";
    this.currentWord = "";
    this.hintString = "";
    this.revealedIndices = [];

    // Get random word options
    this.wordOptions = this.getRandomWords(this.settings.wordCount || 3);

    // 15 seconds for word selection
    this.startTimer(15, () => {
      // Auto-select first word if drawer didn't choose in time
      const autoWord = this.wordOptions[0] || "apple";
      this.selectWord(autoWord);
    });
  }

  getRandomWords(count) {
    const allWords = Object.values(wordsData).flat();
    const shuffled = allWords.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  selectWord(word) {
    this.stopTimer();
    this.currentWord = word.trim().toLowerCase();
    this.phase = "DRAWING";
    
    // Initialize hint string (mask alphabetical characters, keep spaces/hyphens)
    this.hintString = this.generateMaskedWord(this.currentWord);
    this.revealedIndices = [];

    // Start drawing timer
    this.startTimer(this.settings.drawTime || 60, () => {
      this.endRound();
    });
  }

  generateMaskedWord(word) {
    return word
      .split("")
      .map(char => (/[a-zA-Z]/i.test(char) ? "_" : char))
      .join("");
  }

  checkHintReveal() {
    // Reveal letters based on the remaining time and requested hints count
    if (!this.settings.hintsCount || this.settings.hintsCount <= 0) return;
    if (this.currentWord.length <= 2) return; // Don't hint tiny words

    const totalDrawTime = this.settings.drawTime || 60;
    const hintsCount = Math.min(this.settings.hintsCount, this.currentWord.length - 1);
    
    // We want to reveal hints at equal intervals.
    // For example, if hintsCount = 2 and drawTime = 60:
    // Intervals are 60 / (2 + 1) = 20s.
    // Reveal 1 at 40s remaining, reveal 2 at 20s remaining.
    const interval = totalDrawTime / (hintsCount + 1);
    
    // Calculate how many hints should be revealed by now
    const targetReveals = Math.floor((totalDrawTime - this.timeLeft) / interval);
    
    if (this.revealedIndices.length < targetReveals && this.revealedIndices.length < hintsCount) {
      this.revealRandomLetter();
    }
  }

  revealRandomLetter() {
    const unrevealed = [];
    for (let i = 0; i < this.currentWord.length; i++) {
      if (this.currentWord[i] !== " " && !this.revealedIndices.includes(i)) {
        unrevealed.push(i);
      }
    }

    if (unrevealed.length > 0) {
      const randIdx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
      this.revealedIndices.push(randIdx);

      // Rebuild hint string
      const hintArr = this.hintString.split("");
      hintArr[randIdx] = this.currentWord[randIdx];
      this.hintString = hintArr.join("");
    }
  }

  handleGuess(playerId, text) {
    if (this.phase !== "DRAWING") return { isCorrect: false, isClose: false };
    if (playerId === this.drawerId) return { isCorrect: false, isClose: false };

    const player = this.players.find(p => p.socketId === playerId);
    if (!player || player.hasGuessed) return { isCorrect: false, isClose: false };

    const cleanedGuess = text.trim().toLowerCase();
    const isCorrect = cleanedGuess === this.currentWord;

    if (isCorrect) {
      player.hasGuessed = true;
      this.correctGuessesCount++;

      // Scoring Math
      const totalDrawTime = this.settings.drawTime || 60;
      // Base score on how fast they guessed (from 100 to 400 points)
      let score = Math.round(100 + (this.timeLeft / totalDrawTime) * 300);
      
      // Bonus for first guesser
      if (this.correctGuessesCount === 1) {
        score += 100;
      }
      player.addScore(score);
      player.lastGuessTime = Date.now();

      // Check if all players (excluding the drawer) have guessed
      const guessersCount = this.players.filter(p => p.socketId && p.socketId !== this.drawerId).length;
      if (this.correctGuessesCount >= guessersCount) {
        this.endRound();
      }

      return { isCorrect: true, score };
    }

    // Check if the guess is close (e.g. edit distance of 1)
    const isClose = this.levenshteinDistance(cleanedGuess, this.currentWord) === 1;
    return { isCorrect: false, isClose };
  }

  levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            Math.min(
              matrix[i][j - 1] + 1, // insertion
              matrix[i - 1][j] + 1 // deletion
            )
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  endRound() {
    this.stopTimer();
    this.phase = "ROUND_END";

    // Award points to the drawer based on correct guessers percentage
    const drawer = this.players[this.turnIndex];
    const guessersCount = this.players.filter(p => p.socketId && p.socketId !== this.drawerId).length;
    
    if (drawer && guessersCount > 0 && this.correctGuessesCount > 0) {
      const drawerScore = Math.round((this.correctGuessesCount / guessersCount) * 250);
      drawer.addScore(drawerScore);
    } else if (drawer) {
      drawer.addScore(0); // Set points gained this round to 0
    }

    this.onRoundEnd();

    // 8 seconds for round end screen, then proceed
    this.startTimer(8, () => {
      this.nextTurn();
    });
  }

  endGame() {
    this.stopTimer();
    this.phase = "GAME_OVER";
    this.onGameOver();
  }

  getState(hideWord = true) {
    const activeDrawer = this.players[this.turnIndex];
    
    return {
      phase: this.phase,
      currentRound: this.currentRound,
      maxRounds: this.settings.rounds,
      drawerId: this.drawerId,
      drawerName: activeDrawer ? activeDrawer.name : "",
      timeLeft: this.timeLeft,
      wordOptions: this.phase === "SELECTING_WORD" ? this.wordOptions : [],
      wordLength: this.currentWord.length,
      hintString: this.phase === "DRAWING" ? this.hintString : "",
      currentWord: !hideWord || this.phase === "ROUND_END" || this.phase === "GAME_OVER" ? this.currentWord : "",
      players: this.players.map(p => p.toJSON()),
    };
  }
}

module.exports = Game;
