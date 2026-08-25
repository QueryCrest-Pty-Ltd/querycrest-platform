const API_BASE = "https://xkjsydeavdcarwkthppz.supabase.co/functions/v1";
const ORIGIN = window.location.origin;

function getToken() {
  return sessionStorage.getItem('access_token');
}

async  function auth(endpoint){
    try {
    const response =  await fetch(`${API_BASE}${endpoint}`,{
        method:"POST",
        headers:{
            "Content-Type":"application/json",
            "Authorization":getToken(),
        }

    });
    const data = await response.json();
    return data; 
    } catch (error) {
        //alert(` failed to get accommodation`);
        throw error;
        //return [];
    }
  }

async  function getAccommodations(endpoint){
    try {
    const response =  await fetch(`${API_BASE}${endpoint}`,{
        method:"GET",
        headers:{
            "Content-Type":"application/json",
        }

    });
    const data = await response.json();
    return data; 
    } catch (error) {
       // alert(` failed to get accommodation`);
        return [];
    }
  }

 async  function search(endpoint){
    try {
    const response =  await fetch(`${API_BASE}${endpoint}`,{
        method:"GET",
        headers:{
            "Content-Type":"application/json",
        }

    });
    const data = await response.json();
    return data; 
    } catch (error) {
        //alert(` failed to get search results`);
        return [];
    }
  }





(async function () {
  function escH(s) {
    return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function daysUntil(d) {
    if (!d) return null;
    return (new Date(d) - Date.now()) / 86400000;
  }

    const _auth  =  await auth(`/accommodation`);
    var _accAll = [

  ];
  async function getSearch(_accAll,_visibleCount,query){
  try {
    const page_idx = parseInt(_visibleCount/15);
     if(!_auth.error){ alert(`please log in first`);
      return}
     const search_data =  await search(`/accommodation/search?q=${query}?page=${page_idx}`);
   _accAll.length = 0;
   let urls =[];
   if(search_data.urls) urls =search_data.urls;
  for(let i =0;i<search_data.data.length;i++){
    const accommodation = search_data.data[i];
    const id = accommodation.id;
    const _name = accommodation.name;
    const university_name = accommodation.university_name;    
    const price = accommodation.price;
    const location =accommodation.location;
    const type = accommodation.type;
    const accredited = accommodation.accredited;
    const description = accommodation.description;
    const link = accommodation.link;
    const opens = accommodation.opens;
    const closes = accommodation.closes;

    var accreditation ='';   
    if(Boolean(accredited))accreditation='nsfas' ;
    else accreditation ='private'  


   let cover_image =[];
   if(urls[i].links)cover_image =urls[i].links[0];

   let images =[];
   if(urls[i].links)images =urls[i].links;
   

    _accAll.push(
    {
      id: id||0,
      name: _name||'',
      university_name: university_name||'',
      address: location||'',
      price_min: Number(price.min)||0,
      price_max: Number(price.max)||0,
      room_types: [type.first, type.second],
      closing_date: closes||'',
      opening_date: opens||'',
      description: description||'',
      apply_url: '#',
      accreditation: accreditation||true ,
      cover_image:cover_image ,
      images: images,
      features: []
    }
    );
    
   };
   return _accAll;

    
    
  } catch (error) {
   //  
   return [];  
  }    
  }
  async function getAccommodationsData(_accAll,_visibleCount) {
try {
  const page_idx  = parseInt(_visibleCount/15);
  if(!_auth.error){ alert(`please log in first`);
  return}  
  const accommodation_data = await getAccommodations(`/accommodation/list?page=${page_idx}`);
  _accAll.length = 0;

   let urls =[];
   if(accommodation_data.urls) urls =accommodation_data.urls;
  for(let i = 0; i < accommodation_data.data.length;i++){
    const accommodation = accommodation_data.data[i];
   const id = accommodation.id;
    const _name = accommodation.name;
     
    const university_name = accommodation.university_name;
    const price = accommodation.price;
    const location =accommodation.location;
    const type = accommodation.type;
    const accredited = accommodation.accredited;
    const description = accommodation.description;
    const link = accommodation.link;
    const opens = accommodation.opens;
    const closes = accommodation.closes;
    var accreditation ='';   
    if(Boolean(accredited))accreditation='nsfas' ;
    else accreditation ='private'  
   let cover_image =[];
   if(urls[i].links)cover_image =urls[i].links[0];

   let images =[];
   if(urls[i].links)images =urls[i].links;
      
   
    _accAll.push(
    {
      id: id||0,
      name: _name||'',
      university_name: university_name||'',
      address: location||'',
      price_min: Number(price.min)||0,
      price_max: Number(price.max)||0,
      room_types: [type.first, type.second],
      closing_date: closes||'',
      opening_date: opens||'',
      description: description||'',
      apply_url: '#',
      accreditation: accreditation||true ,
      cover_image: cover_image,
      images: images,
      features: []
    }
    );

  };

    return _accAll;
  
} catch (error) {
//  
return [];
}

  }
  // ----- STATIC ACCOMMODATIONS (Your 15) -----




  var _visibleCount = 15;
  var _currentSlideIndex = 0;
  var _currentSlideImages = [];
  var _slideInterval = null;

  function buildAccCard(a) {
    var days = daysUntil(a.closing_date);
    var closed = days !== null && days < 0;
    var urgent = days !== null && days >= 0 && days <= 14;

    var card = document.createElement('div');
    card.className = 'pn';
    card.style.cssText = 'overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:all .2s;';
    card.dataset.accId = a.id;
    card.onclick = function() { window.showDetailView(a.id); };

    var imgHtml = a.cover_image
      ? '<img src="' + escH(a.cover_image) + '" alt="' + escH(a.name) + '" style="width:100%;height:175px;object-fit:cover;display:block;" loading="lazy">'
      : (a.images && a.images.length > 0 ? 
          '<img src="' + escH(a.images[0]) + '" alt="' + escH(a.name) + '" style="width:100%;height:175px;object-fit:cover;display:block;" loading="lazy">' :
          '<div style="height:175px;background:linear-gradient(135deg,#2c3e50,#3498db);display:flex;align-items:center;justify-content:center;"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>');

    var priceHtml = '';
    if (a.price_min || a.price_max) {
      priceHtml = '<span style="font-size:.8rem;font-weight:700;color:var(--green);">R' +
        (a.price_min ? Number(a.price_min).toLocaleString() : '?') +
        (a.price_max && a.price_max !== a.price_min ? ' – R' + Number(a.price_max).toLocaleString() : '') +
        '/month</span>';
    }

    var roomHtml = (a.room_types || []).slice(0, 3).map(function(r) {
      return '<span style="display:inline-block;background:var(--surface);border:1px solid var(--bdr);color:var(--t2);font-size:.68rem;padding:2px 8px;border-radius:99px;margin:2px 2px 2px 0;">' + escH(r) + '</span>';
    }).join('');

    var closingStyle = closed ? 'color:var(--t3);text-decoration:line-through;' : urgent ? 'color:#b91c1c;font-weight:700;' : 'color:var(--t2);';
    var closingHtml = a.closing_date ? '<span style="font-size:.74rem;' + closingStyle + '">Closes: ' + fmtDate(a.closing_date) + (closed ? ' · Closed' : '') + '</span>' : '';

    var accBadge = '';
    if (a.accreditation === 'nsfas') {
      accBadge = '<span class="bd bd-nsfas" style="font-size:.65rem;">✓ NSFAS Accredited</span>';
    } else if (a.accreditation === 'private') {
      accBadge = '<span class="bd bd-private" style="font-size:.65rem;">Private Accommodation</span>';
    }

    var openingHtml = a.opening_date && !closed ? '<span style="font-size:.72rem;color:var(--t3);">Opens: ' + fmtDate(a.opening_date) + '</span>' : '';

    card.innerHTML =
      imgHtml +
      '<div style="padding:16px 18px;flex:1;display:flex;flex-direction:column;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:5px;">' +
          '<h4 style="font-size:.95rem;font-weight:700;color:var(--dark2);margin:0;flex:1;line-height:1.3;">' + escH(a.name) + '</h4>' +
          accBadge +
          (urgent ? '<span class="bd bd-danger" style="flex-shrink:0;font-size:.65rem;">Closing Soon</span>' : '') +
        '</div>' +
        '<p style="font-size:.8rem;color:var(--primary);font-weight:600;margin:0 0 4px;">' + escH(a.university_name) + '</p>' +
        (a.address ? '<p style="font-size:.74rem;color:var(--t3);margin:0 0 8px;">' + escH(a.address) + '</p>' : '') +
        (roomHtml ? '<div style="margin-bottom:8px;">' + roomHtml + '</div>' : '') +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:10px;">' + priceHtml + closingHtml + '</div>' +
        (a.description ? '<p style="font-size:.78rem;color:var(--t2);line-height:1.55;margin:0 0 12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + escH(a.description) + '</p>' : '') +
        '<div style="margin-top:auto;display:flex;gap:8px;align-items:center;">' + openingHtml + '</div>' +
      '</div>';

    return card;
  }

  function renderDetail(a) {
    if (!a) return '<div style="padding:40px;text-align:center;color:var(--t3);">Accommodation not found.</div>';

    var days = daysUntil(a.closing_date);
    var closed = days !== null && days < 0;

    var imgs = a.images || ['https://placehold.co/600x400/3498db/fff?text=No+Image','https://placehold.co/600x400/2980b9/fff?text=No+Image','https://placehold.co/600x400/2c3e50/fff?text=No+Image','https://placehold.co/600x400/34495e/fff?text=No+Image'];
    
    var galleryHtml = '';
    if (imgs.length >= 4) {
      galleryHtml = 
        '<div class="gallery-grid">' +
          '<img class="main-img" src="' + escH(imgs[0]) + '" alt="' + escH(a.name) + '" onclick="window.openSlideshow(' + a.id + ', 0)">' +
          '<img class="sub-img" src="' + escH(imgs[1]) + '" alt="' + escH(a.name) + '" onclick="window.openSlideshow(' + a.id + ', 1)">' +
          '<img class="sub-img" src="' + escH(imgs[2]) + '" alt="' + escH(a.name) + '" onclick="window.openSlideshow(' + a.id + ', 2)">' +
          '<img class="sub-img" src="' + escH(imgs[3]) + '" alt="' + escH(a.name) + '" onclick="window.openSlideshow(' + a.id + ', 3)">' +
        '</div>';
    } else {
      galleryHtml = '<img src="' + escH(imgs[0]) + '" alt="' + escH(a.name) + '" style="width:100%;height:200px;object-fit:cover;border-radius:var(--r2);margin-bottom:16px;cursor:pointer;" onclick="window.openSlideshow(' + a.id + ', 0)">';
    }

    var accBadge = '';
    if (a.accreditation === 'nsfas') {
      accBadge = '<span class="bd bd-nsfas">✓ NSFAS Accredited</span>';
    } else if (a.accreditation === 'private') {
      accBadge = '<span class="bd bd-private">Private Accommodation</span>';
    }

    var roomTypesHtml = (a.room_types || []).map(function(r) {
      return '<span class="room-tag">' + escH(r) + '</span>';
    }).join('');

    var featuresHtml = (a.features || []).map(function(f) {
      return '<span class="room-tag" style="background:var(--surface2);color:var(--t2);">' + escH(f) + '</span>';
    }).join('');

    var priceDisplay = '';
    if (a.price_min && a.price_max) {
      priceDisplay = 'R' + Number(a.price_min).toLocaleString() + ' – R' + Number(a.price_max).toLocaleString();
    } else if (a.price_min) {
      priceDisplay = 'R' + Number(a.price_min).toLocaleString();
    } else {
      priceDisplay = 'Price on request';
    }

    return galleryHtml +
      '<div class="detail-badges">' + accBadge + '</div>' +
      '<h2 class="detail-title">' + escH(a.name) + '</h2>' +
      '<p class="detail-university">' + escH(a.university_name) + '</p>' +

      '<div class="detail-section">' +
        '<h3>About this property</h3>' +
        '<div class="detail-grid">' +
          '<div class="detail-item"><label>Price</label><span>' + priceDisplay + ' / month</span></div>' +
          '<div class="detail-item"><label>Location</label><span>' + escH(a.address || 'Not specified') + '</span></div>' +
          '<div class="detail-item"><label>Opening Date</label><span>' + (a.opening_date ? fmtDate(a.opening_date) : '—') + '</span></div>' +
          '<div class="detail-item"><label>Closing Date</label><span>' + (a.closing_date ? fmtDate(a.closing_date) + (closed ? ' (Closed)' : '') : '—') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="detail-section">' +
        '<h3>Description</h3>' +
        '<p class="detail-desc">' + escH(a.description || 'No description available.') + '</p>' +
      '</div>' +

      (roomTypesHtml ? 
        '<div class="detail-section">' +
          '<h3>Room Types</h3>' +
          '<div class="detail-rooms">' + roomTypesHtml + '</div>' +
        '</div>' : '') +

      (featuresHtml ?
        '<div class="detail-section">' +
          '<h3>Features & Amenities</h3>' +
          '<div class="detail-rooms">' + featuresHtml + '</div>' +
        '</div>' : '') +

      '<div style="margin-top:12px;">' +
        (a.apply_url && !closed ? 
          '<a href="' + escH(a.apply_url) + '" target="_blank" rel="noopener" class="btn btn-primary">Apply Now →</a>' :
          (closed ? '<span class="bd bd-rejected" style="font-size:.85rem;padding:8px 16px;">Applications Closed</span>' : '')) +
      '</div>';
  }

  // ----- SLIDESHOW FUNCTIONS -----
  window.openSlideshow = function(accId, index) {
    var a = _accAll.find(function(item) { return item.id === accId; });
    if (!a || !a.images || a.images.length === 0) return;

    _currentSlideImages = a.images;
    _currentSlideIndex = index || 0;

    var overlay = document.getElementById('slideshowOverlay');
    var img = document.getElementById('slideshowImg');
    var counter = document.getElementById('slideshowCounter');
    var dots = document.getElementById('slideshowDots');

    img.src = _currentSlideImages[_currentSlideIndex];
    counter.textContent = (_currentSlideIndex + 1) + ' / ' + _currentSlideImages.length;

    dots.innerHTML = '';
    for (var i = 0; i < _currentSlideImages.length; i++) {
      var dot = document.createElement('button');
      dot.className = 'slideshow-dot' + (i === _currentSlideIndex ? ' active' : '');
      dot.onclick = function(idx) { return function() { goToSlide(idx); }; }(i);
      dots.appendChild(dot);
    }

    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    startAutoSlide();
  };

  window.closeSlideshow = function() {
    document.getElementById('slideshowOverlay').classList.remove('show');
    document.body.style.overflow = '';
    stopAutoSlide();
  };

  window.changeSlide = function(direction) {
    if (_currentSlideImages.length === 0) return;
    _currentSlideIndex = (_currentSlideIndex + direction + _currentSlideImages.length) % _currentSlideImages.length;
    updateSlide();
  };

  function goToSlide(index) {
    if (index < 0 || index >= _currentSlideImages.length) return;
    _currentSlideIndex = index;
    updateSlide();
  }

  function updateSlide() {
    var img = document.getElementById('slideshowImg');
    var counter = document.getElementById('slideshowCounter');
    var dots = document.querySelectorAll('.slideshow-dot');

    img.src = _currentSlideImages[_currentSlideIndex];
    counter.textContent = (_currentSlideIndex + 1) + ' / ' + _currentSlideImages.length;

    dots.forEach(function(dot, i) {
      dot.className = 'slideshow-dot' + (i === _currentSlideIndex ? ' active' : '');
    });

    startAutoSlide();
  }

  function startAutoSlide() {
    stopAutoSlide();
    _slideInterval = setInterval(function() {
      changeSlide(1);
    }, 3000);
  }

  function stopAutoSlide() {
    if (_slideInterval) {
      clearInterval(_slideInterval);
      _slideInterval = null;
    }
  }

  document.addEventListener('keydown', function(e) {
    if (!document.getElementById('slideshowOverlay').classList.contains('show')) return;
    if (e.key === 'Escape') closeSlideshow();
    if (e.key === 'ArrowLeft') changeSlide(-1);
    if (e.key === 'ArrowRight') changeSlide(1);
  });

  // ----- VIEW MORE -----
  window.loadMoreAccommodations = async function() {
    _visibleCount += 15;
    if (_visibleCount >= _accAll.length) {
      _visibleCount = _accAll.length;
      document.getElementById('viewMoreBtn').style.display = 'none';
    }
    await renderVisibleAccommodations();
  };

  async function renderVisibleAccommodations() {
    var grid = document.getElementById('acc-grid');
    if (!grid) return;

    var filtered = await  getFilteredAccommodations();
    //alert(`filtered ${filtered}`);
    if(filtered){
    var visible = filtered.slice(0, _visibleCount);
    
    grid.innerHTML = '';
    visible.forEach(function(a) { grid.appendChild(buildAccCard(a)); });

    var cnt = document.getElementById('acc-count');
    if (cnt) cnt.textContent = filtered.length + ' listing' + (filtered.length !== 1 ? 's' : '');

    var viewMoreBtn = document.getElementById('viewMoreBtn');
    if (viewMoreBtn) {
      if (_visibleCount >= filtered.length) {
        viewMoreBtn.style.display = 'none';
      } else {
        viewMoreBtn.style.display = 'inline-flex';
        viewMoreBtn.textContent = 'View More (' + (filtered.length - _visibleCount) + ' remaining)';
      }
    }

    var empty = document.getElementById('acc-empty');
    if (empty) empty.style.display = filtered.length ? 'none' : 'block';
    grid.style.display = filtered.length ? 'grid' : 'none';
    }
  }

  async function getFilteredAccommodations() {
    var q = ((document.getElementById('acc-search') || {}).value || '').toLowerCase().trim();
    //perform seach if q is not empty

    if(q){
    
       //(async()=>{_accAll=await getSearch(_accAll,_visibleCount,q)})()
       return _accAll = await getSearch(_accAll,_visibleCount,q);
       //return _accAll;
       //return q ? _accAll.filter(function(a) { return (a.university_name + ' ' + a.name).toLowerCase().indexOf(q) !== -1; }) : _accAll.slice();
    } if(!q||q==='') {
    //(async()=>{_accAll=await getAccommodationsData(_accAll,_visibleCount);})().then(()=>{return _accAll});
     return _accAll =await getAccommodationsData(_accAll,_visibleCount);         
     
    }

  }

  window.accFilter = async function () {
    _visibleCount = 15;

    var viewMoreBtn = document.getElementById('viewMoreBtn');
    if (viewMoreBtn) viewMoreBtn.style.display = 'inline-flex';
    await renderVisibleAccommodations();
  };

  window.showDetailView = function(id) {
    var a = _accAll.find(function(item) { return item.id === id; });
    if (!a) return;

    document.getElementById('accommodation-list').style.display = 'none';
    var detailSection = document.getElementById('accommodation-detail');
    detailSection.classList.add('show');
    document.getElementById('detail-content').innerHTML = renderDetail(a);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.showListView = async function() {
    document.getElementById('accommodation-list').style.display = 'block';
    var detailSection = document.getElementById('accommodation-detail');
    detailSection.classList.remove('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await renderVisibleAccommodations();
  };

  window.qcRefresh = function(btn, callback) {
    if (btn) { btn.classList.add('spinning'); }
    if (callback) { callback(); }
    setTimeout(function() { if (btn) btn.classList.remove('spinning'); }, 800);
  };

  window.qcLoadAccommodations =async function () {
    _visibleCount = 15;
    var viewMoreBtn = document.getElementById('viewMoreBtn');
    if (viewMoreBtn) viewMoreBtn.style.display = 'inline-flex';
    await renderVisibleAccommodations();
  };

  await window.qcLoadAccommodations();
})();
