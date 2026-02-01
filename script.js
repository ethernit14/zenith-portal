function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    if (menu) {
        menu.classList.toggle('active'); 
    }
}

function createStars() {
    const container = document.getElementById('stars1') || document.getElementById('stars-container');
    if (!container) return;
    container.innerHTML = ''; 

    for (let i = 0; i < 150; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        const size = Math.random() * 3 + 'px';
        star.style.width = size;
        star.style.height = size;
        
        star.style.setProperty('--duration', (Math.random() * 3 + 2) + 's');
        star.style.setProperty('--speed', (Math.random() * 40 + 40) + 's');
        
        container.appendChild(star);
    }
}

document.addEventListener('DOMContentLoaded', createStars);
