function toggleMenu() {
    document.getElementById('sideMenu').classList.toggle('active');
}

// Yıldızları oluşturma
const starContainer = document.getElementById('stars-container');
if (starContainer) {
    for (let i = 0; i < 200; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        const size = Math.random() * 2.5;
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.animationDuration = (Math.random() * 3 + 2) + 's';
        starContainer.appendChild(star);
    }
}

// Kayan yıldız efekti
setInterval(() => {
    if (Math.random() > 0.8) {
        const shooter = document.createElement('div');
        shooter.className = 'shooting-star';
        shooter.style.left = Math.random() * 100 + '%';
        shooter.style.top = Math.random() * 50 + '%';
        document.body.appendChild(shooter);
        setTimeout(() => shooter.remove(), 3000);
    }
}, 4000);
