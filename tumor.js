(function () {
    // Ported from tumors.py — Logistic Regression (L2 reg. during training,
    // lambda=10) trained via manual gradient descent (100,000 iterations,
    // alpha = 0.001) on 9 mean-normalized features, 3 of which are
    // engineered: size^2, size*growth, age*toughness. Values below are the
    // exact means/devs/weights/bias printed by that training run.
    const MEANS = [5.06015, 53.105, 0.4525, 5.41925, 0.38375, 0.49055, 30.17014075, 2.479691875, 286.658625];
    const DEVS = [2.136591380563911, 20.81289203834969, 0.4977386362339175, 2.599803730572752, 0.4862981981253889, 0.5090124728334268, 23.32057402698772, 3.1056895379724425, 187.28556978744885];
    const WEIGHTS = [0.61961736, 0.2319535, 0.96189911, 0.76890237, 0.65736064, 0.8898097, 0.47244201, 0.89328408, 0.52377156];
    const BIAS = -0.1537;
    const THRESHOLD = 0.5;

    const formEl = document.getElementById('predictForm');
    const resultEl = document.getElementById('predictResult');
    const valueEl = document.getElementById('predictValue');
    const subEl = document.getElementById('predictSub');
    const barFillEl = document.getElementById('predictBarFill');
    const btn = document.getElementById('predictBtn');

    if (!formEl) return;

    const state = { rough: 0, heterogeneous: 0 };

    function rangeField(key, label, min, max, step) {
        const field = document.createElement('div');
        field.className = 'predict-field';
        const initial = (min + max) / 2;
        field.innerHTML = `
            <label for="f_${key}">${label} <span class="value" id="v_${key}">${initial.toFixed(step < 1 ? 2 : 0)}</span></label>
            <input type="range" id="f_${key}" min="${min}" max="${max}" step="${step}" value="${initial}">
        `;
        formEl.appendChild(field);
        const input = field.querySelector('input');
        const valSpan = field.querySelector('.value');
        input.addEventListener('input', () => {
            valSpan.textContent = Number(input.value).toFixed(step < 1 ? 2 : 0);
        });
    }

    function toggleField(key, label, offText, onText) {
        const field = document.createElement('div');
        field.className = 'predict-field';
        field.innerHTML = `
            <label>${label}</label>
            <div class="predict-toggle-row">
                <button type="button" class="predict-toggle-btn active" data-val="0">${offText}</button>
                <button type="button" class="predict-toggle-btn" data-val="1">${onText}</button>
            </div>
        `;
        formEl.appendChild(field);
        const buttons = field.querySelectorAll('.predict-toggle-btn');
        buttons.forEach(b => {
            b.addEventListener('click', () => {
                buttons.forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                state[key] = parseInt(b.dataset.val, 10);
            });
        });
    }

    rangeField('size', 'Tumor Size (cm)', 0.1, 13.48, 0.01);
    rangeField('age', "Patient's Age", 18, 89, 1);
    toggleField('rough', 'Surface Texture', 'Smooth', 'Rough');
    rangeField('toughness', 'Toughness', 1.0, 10.0, 0.1);
    toggleField('heterogeneous', 'Tissue Composition', 'Homogeneous', 'Heterogeneous');
    rangeField('growth', 'Growth Rate (cm/month)', 0.0, 3.0, 0.01);

    function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

    function predict() {
        const size = parseFloat(document.getElementById('f_size').value);
        const age = parseFloat(document.getElementById('f_age').value);
        const isRough = state.rough;
        const toughness = parseFloat(document.getElementById('f_toughness').value);
        const isHetero = state.heterogeneous;
        const growth = parseFloat(document.getElementById('f_growth').value);

        const sizeSq = size * size;
        const sizeGrowth = size * growth;
        const ageToughness = age * toughness;

        const raw = [size, age, isRough, toughness, isHetero, growth, sizeSq, sizeGrowth, ageToughness];

        let z = BIAS;
        raw.forEach((val, i) => {
            const scaled = (val - MEANS[i]) / DEVS[i];
            z += scaled * WEIGHTS[i];
        });
        return sigmoid(z);
    }

    btn.addEventListener('click', () => {
        const prob = predict();
        const isMalignant = prob >= THRESHOLD;
        const pct = (isMalignant ? prob : 1 - prob) * 100;

        valueEl.textContent = isMalignant ? 'Malignant' : 'Benign';
        subEl.textContent = `Model confidence: ${pct.toFixed(1)}%`;
        barFillEl.style.width = (prob * 100) + '%';
        resultEl.classList.remove('malignant', 'benign');
        resultEl.classList.add(isMalignant ? 'malignant' : 'benign');
        resultEl.classList.add('show');
    });
})();
