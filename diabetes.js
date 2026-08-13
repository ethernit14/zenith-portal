(function () {
    // Ported from MLR.py — Multiple Linear Regression trained via manual
    // gradient descent (100,000 iterations, alpha = 0.001, mean-normalized
    // features). Values below are the exact means/devs/weights/bias printed
    // by that training run.
    const FEATURES = [
        { key: 'age', label: 'Age', min: 18, max: 84, step: 1, mean: 50.89375, dev: 19.931632169431083 },
        { key: 'bmi', label: 'BMI', min: 18.6, max: 45, step: 0.1, mean: 31.84661974614444, dev: 7.8398339592997734 },
        { key: 'bp', label: 'Blood Pressure', min: 70, max: 149, step: 1, mean: 109.5325, dev: 22.092225866806633 },
        { key: 'glucose', label: 'Glucose', min: 70.1, max: 249.9, step: 0.1, mean: 161.6415681968149, dev: 51.78416216845209 },
        { key: 'exercise', label: 'Exercise Time (min)', min: 30, max: 179, step: 1, mean: 105.37375, dev: 43.058699015849285 },
        { key: 'stress', label: 'Stress Level', min: 1, max: 10, step: 1, mean: 5.49125, dev: 2.905584870251183 }
    ];
    const WEIGHTS = [50.46069531, 48.88759077, 17.10905064, 20.61467589, -8.08891278, 4.81590567];
    const BIAS = 463.4582;
    const TARGET_MIN = 254.5;
    const TARGET_MAX = 654.3;

    const formEl = document.getElementById('predictForm');
    const resultEl = document.getElementById('predictResult');
    const valueEl = document.getElementById('predictValue');
    const subEl = document.getElementById('predictSub');
    const barFillEl = document.getElementById('predictBarFill');
    const btn = document.getElementById('predictBtn');

    if (!formEl) return;

    FEATURES.forEach(f => {
        const field = document.createElement('div');
        field.className = 'predict-field';
        field.innerHTML = `
            <label for="f_${f.key}">${f.label} <span class="value" id="v_${f.key}">${((f.min + f.max) / 2).toFixed(f.step < 1 ? 1 : 0)}</span></label>
            <input type="range" id="f_${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${((f.min + f.max) / 2).toFixed(f.step < 1 ? 1 : 0)}">
        `;
        formEl.appendChild(field);
        const input = field.querySelector('input');
        const valSpan = field.querySelector('.value');
        input.addEventListener('input', () => {
            valSpan.textContent = Number(input.value).toFixed(f.step < 1 ? 1 : 0);
        });
    });

    function predict() {
        let z = BIAS;
        FEATURES.forEach((f, i) => {
            const raw = parseFloat(document.getElementById(`f_${f.key}`).value);
            const scaled = (raw - f.mean) / f.dev;
            z += scaled * WEIGHTS[i];
        });
        return z;
    }

    btn.addEventListener('click', () => {
        const score = predict();
        const clamped = Math.max(TARGET_MIN, Math.min(TARGET_MAX, score));
        const pct = ((clamped - TARGET_MIN) / (TARGET_MAX - TARGET_MIN)) * 100;

        valueEl.textContent = score.toFixed(1);
        subEl.textContent = `Model range: ${TARGET_MIN}–${TARGET_MAX}`;
        barFillEl.style.width = pct + '%';
        resultEl.classList.add('show');
    });
})();
