const words = ['apple', 'bread', 'chair', 'mouse', 'piano', 'radio', 'smile', 'table', 'water', 'zebra'];
const maxAttempts = 6;
let attempts = 0;
let answer = words[Math.floor(Math.random() * words.length)];

function submitGuess() {
    const guessInput = document.getElementById('guess');
    const feedback = document.getElementById('feedback');
    const guess = guessInput.value.toLowerCase();
    let result = '';

    if (guess.length !== 5) {
        alert('Enter a 5-letter word.');
        return;
    }

    for (let i = 0; i < 5; i++) {
        const c = guess[i];
        if (answer.includes(c)) {
            result += (answer[i] === c) ? `<span style="color: green">${c.toUpperCase()}</span>` : `<span style="color: orange">${c.toUpperCase()}</span>`;
        } else {
            result += `<span>${c.toUpperCase()}</span>`;
        }
    }

    const div = document.createElement('div');
    div.innerHTML = result;
    feedback.appendChild(div);

    attempts++;

    if (guess === answer) {
        alert('You win! The word was ' + answer.toUpperCase() + '.');
        resetGame();
    } else if (attempts >= maxAttempts) {
       
        alert('You ran out of attempts! The word was ' + answer.toUpperCase() + '.');
        resetGame();
    }
}

function resetGame() {
    attempts = 0;
    answer = words[Math.floor(Math.random() * words.length)];
    const guessInput = document.getElementById('guess');
    guessInput.value = '';
    const feedback = document.getElementById('feedback');
    while (feedback.firstChild) {
        feedback.removeChild(feedback.firstChild);
    }
}

