function convert() {
    const score = document.querySelector("#score-input").value.trim();
    const diff = parseInt(document.querySelector("#diff").value);
    const tuples = score.split("&");
    const data = new Map(tuples.map(tuple => tuple.split("=")));
    
    const transformed = new Map([...data].map(([k, v]) => {
        if (k.indexOf("data") >= 0 && !k.match(/speed[0-9]*_data/) && !v.match(/[^0-9,]/)) {
            const new_v = v.split(",").map(v => parseInt(v) + diff).join(",");
            return [k, new_v];
        } else if (k.match(/speed[0-9]*_data/)) {
            const new_v = v.split(",").map((v, i) => {
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

    const output = [...transformed].filter(([k, v]) => {
        return v != undefined;
    }).map(([k, v]) => {
        return k + "=" + v;
    }).join("&");

    document.querySelector("#score-output").value = output;
}