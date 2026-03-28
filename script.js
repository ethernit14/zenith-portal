function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    if (menu) {
        menu.classList.toggle('active'); 
    }
}

function toggleInfo(e) {
    e.stopPropagation();
    const popup = document.getElementById('infoPopup');
    popup.classList.toggle('open');
}

document.addEventListener('click', (e) => {
    // Menu kapat
    const menu = document.getElementById('sideMenu');
    const hamburger = document.querySelector('.hamburger');
    if (menu && menu.classList.contains('active')) {
        if (!menu.contains(e.target) && !hamburger.contains(e.target)) {
            menu.classList.remove('active');
        }
    }

    // Info popup kapat
    const popup = document.getElementById('infoPopup');
    const btn = document.querySelector('.info-btn');
    if (popup && btn) {
        if (!popup.contains(e.target) && !btn.contains(e.target)) {
            popup.classList.remove('open');
        }
    }
});

function createStars() {
    const container = document.getElementById('stars-container');
    if (!container) return;
    container.innerHTML = ''; 
    for (let i = 0; i < 400; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        const size = Math.random() * 2.5 + 'px';
        star.style.width = size;
        star.style.height = size;
        star.style.setProperty('--duration', (Math.random() * 3 + 2) + 's'); 
        star.style.setProperty('--twinkle-delay', (Math.random() * 5) + 's'); 
        container.appendChild(star);
    }
}

function createShootingStar() {
    const container = document.getElementById('stars-container');
    if (!container) return;
    const star = document.createElement('div');
    star.className = 'shooting-star anim
