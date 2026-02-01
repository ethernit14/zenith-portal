function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    if (menu) menu.classList.toggle('active'); 
}

function createStars() {
    const container = document.getElementById('stars1') || document.getElementById('stars-container');
    if (!container) return;
    container.innerHTML = ''; 

    for (let i = 0; i < 200; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = (Math.random() * 200 - 50) + '%';
        star.style.top = (Math.random() * 100) + '%';
        
        const size = Math.random() * 2.5 + 'px';
        star.style.width = size;
        star.style.height = size;
        
        star.style.setProperty('--duration', (Math.random() * 3 + 2) + 's'); 
        star.style.setProperty('--twinkle-delay', (Math.random() * 5) + 's'); 
        star.style.setProperty('--speed', (Math.random() * 100 + 150) + 's'); 
        
        container.appendChild(star);
    }
}

function createShootingStar() {
    const container = document.getElementById('stars-container');
    if (!container) return;
    const star = document.createElement('div');
    star.className = 'shooting-star animate-shooting';
    star.style.top = Math.random() * 40 + '%';
    star.style.left = (Math.random() * 50 + 50) + '%';
    container.appendChild(star);
    setTimeout(() => star.remove(), 2000); 
}

function startShootingStars() {
    setTimeout(() => {
        createShootingStar();
        startShootingStars();
    }, Math.random() * 8000 + 4000); 
}

document.addEventListener('DOMContentLoaded', () => {
    createStars();
    startShootingStars();
});
