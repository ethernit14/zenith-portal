function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    if (menu) {
        menu.classList.toggle('active'); // Menüyü açar/kapatır
    }
}

function createStars() {
    // Hem 'stars1' hem de genel konteynırı kontrol et
    const container = document.getElementById('stars1') || document.getElementById('stars-container');
    if (!container) return;
    
    // Mevcut yıldızları temizle (Sayfa yenilenirse üst üste binmesin)
    container.innerHTML = ''; 

    for (let i = 0; i < 150; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        const size = Math.random() * 3 + 'px';
        star.style.width = size;
        star.style.height = size;
        // Yıldızlara hafif bir animasyon süresi ekleyelim
        star.style.animationDuration = (Math.random() * 3 + 2) + 's';
        container.appendChild(star);
    }
}

// Sayfa tamamen yüklendiğinde yıldızları oluştur
document.addEventListener('DOMContentLoaded', createStars);
