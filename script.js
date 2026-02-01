function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    menu.classList.toggle('active');
}

// Yıldızları oluşturma kodu (Buraya daha önceki scripti ekleyebilirsin)
const container = document.getElementById('stars1');
for (let i = 0; i < 150; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.width = Math.random() * 3 + 'px';
    star.style.height = star.style.width;
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDuration = (Math.random() * 3 + 2) + 's';
    container.appendChild(star);
}
