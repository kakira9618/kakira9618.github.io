function convert() {
    var score = document.querySelector("#score-input").value.trim();
    var diff = parseInt(document.querySelector("#diff").value);
    var tuples = score.split("&");
    var data = new Map(tuples.map(tuple => tuple.split("=")));
    
    var transformed = new Map([...data].map(([k, v]) => {
        if (k.indexOf("data") >= 0 && !k.match(/speed[0-9]*_data/) && !v.match(/[^0-9,]/)) {
            var new_v = v.split(",").map(v => parseInt(v) + diff).join(",");
            return [k, new_v];
        } else if (k.match(/speed[0-9]*_data/)) {
            var new_v = v.split(",").map((v, i) => {
                if (i % 2 == 0) {
                    return parseInt(v) + diff;
                } else {
                    return parseFloat(v);
                }
            }).join(",");
            return [k, new_v];
        } else {
            return [k, v];
        }
    }));

    var output = [...transformed].filter(([k, v]) => {
        return v != undefined;
    }).map(([k, v]) => {
        return k + "=" + v;
    }).join("&");

    document.querySelector("#score-output").value = output;
}