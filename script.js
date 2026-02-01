function toggleMenu() {
    const sideMenu = document.getElementById('sideMenu');
    // 'active' sınıfı varsa çıkarır, yoksa ekler
    sideMenu.classList.toggle('active');
}

// Yıldız Oluşturma (Görünürlük için şart)
function createStars() {
    const container = document.getElementById('stars-container');
    if (!container) return;
    
    for (let i = 0; i < 150; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        const size = Math.random() * 3 + 'px';
        star.style.width = size;
        star.style.height = size;
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.animationDuration = (Math.random() * 3 + 2) + 's';
        container.appendChild(star);
    }
}

document.addEventListener('DOMContentLoaded', createStars);
