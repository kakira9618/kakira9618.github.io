function setup() {
    var patternDiv = document.querySelector("#pattern-div");
    var resultDiv = document.querySelector("#result-div");
    document.querySelector("#save-to-png").disabled = false;
    document.querySelector("#save-to-png-pattern").disabled = false;
    patternDiv.style.display = "inline";
    resultDiv.style.display = "inline";

    var patternCanvas = document.querySelector("#pattern");
    var resultCanvas = document.querySelector("#result");
    var arrowWidth = +document.querySelector("#arrow-width").value;
    patternCanvas.width = +document.querySelector("#arrow-dx").value + arrowWidth;
    patternCanvas.height = document.querySelector("#pat-height").value;
    resultCanvas.width = patternCanvas.width * document.querySelector("#loop-freq").value;
    resultCanvas.height = document.querySelector("#pat-height").value;
}

function drawPattern(ctx, startX) {
    var patWidth = +document.querySelector("#pattern").width;
    var patHeight = +document.querySelector("#pattern").height;
    var arrowWidth = +document.querySelector("#arrow-width").value;
    var arrowDx = +document.querySelector("#arrow-dx").value;
    if (patWidth <= 0 || patHeight <= 0 || arrowWidth <= 0 || arrowDx <= 0) return;

    ctx.beginPath();
    ctx.fillStyle = document.querySelector("#bg-color").value;
    ctx.rect(startX, 0, patWidth, patHeight);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = document.querySelector("#arrow-color").value;
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX + arrowDx, patHeight / 2);
    ctx.lineTo(startX, patHeight);
    ctx.lineTo(startX + arrowWidth, patHeight);
    ctx.lineTo(startX + arrowWidth + arrowDx, patHeight / 2);
    ctx.lineTo(startX + arrowWidth, 0);
    ctx.closePath();
    ctx.fill();
}

function drawResult(resultCtx) {
    var n = +document.querySelector("#loop-freq").value;
    var patWidth = +document.querySelector("#pattern").width;
    for (var i = 0; i < n; i++) {
        drawPattern(resultCtx, patWidth * i);
    }
}

function generate() {
    setup();
    var patternCtx = document.querySelector("#pattern").getContext("2d");
    var resultCtx = document.querySelector("#result").getContext("2d");

    drawPattern(patternCtx, 0);
    drawResult(resultCtx, 0);
}

function saveToPng() {
    var canvas = document.querySelector("#result");
    var link = document.createElement("a");
    link.href = canvas.toDataURL();
    link.download = "arrow.png";
    link.click();
}
function saveToPngPat() {
    var canvas = document.querySelector("#pattern");
    var link = document.createElement("a");
    link.href = canvas.toDataURL();
    link.download = "arrow-pattern.png";
    link.click();
}
