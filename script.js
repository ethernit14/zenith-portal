function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    // active sınıfı varsa siler, yoksa ekler
    menu.classList.toggle('active');
}

// Yıldız Oluşturucu
function createStars() {
    const container = document.getElementById('stars1');
    if (!container) return;
    for (let i = 0; i < 150; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.width = Math.random() * 3 + 'px';
        star.style.height = star.style.width;
        container.appendChild(star);
    }
}
document.addEventListener('DOMContentLoaded', createStars);
