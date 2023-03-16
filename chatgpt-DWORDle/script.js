const words = ['apple', 'bread', 'chair', 'mouse', 'piano', 'radio', 'smile', 'table', 'water', 'zebra'];
const maxAttempts = 10;
let attempts = 0;
let answer1 = words[Math.floor(Math.random() * words.length)];
let answer2 = words[Math.floor(Math.random() * words.length)];

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

        if (answer1[i] === c || answer2[i] === c) {
            result += `<span style="color: green">${c.toUpperCase()}</span>`;
        } else {
            let found = false;
            for (let j = 0; j < 5; j++) {
                if (j !== i && (answer1[j] === c || answer2[j] === c)) {
                    found = true;
                    break;
                }
            }
            result += found ? `<span style="color: orange">${c.toUpperCase()}</span>` : `<span style="color: gray">${c.toUpperCase()}</span>`;
        }
    }

    const div = document.createElement('div');
    div.innerHTML = result;
    feedback.appendChild(div);

    attempts++;

    if (guess === answer1 || guess === answer2) {
        alert('You win! The words were ' + answer1.toUpperCase() + ' and ' + answer2.toUpperCase() + '.');
        resetGame();
    } else if (attempts >= maxAttempts) {
        alert('You ran out of attempts! The words were ' + answer1.toUpperCase() + ' and ' + answer2.toUpperCase() + '.');
        resetGame();
    }
}

function resetGame() {
    attempts = 0;
    answer1 = words[Math.floor(Math.random() * words.length)];
    answer2 = words[Math.floor(Math.random() * words.length)];
    const guessInput = document.getElementById('guess');
    guessInput.value = '';
    const feedback = document.getElementById('feedback');
    while (feedback.firstChild) {
        feedback.removeChild(feedback.firstChild);
    }
}
