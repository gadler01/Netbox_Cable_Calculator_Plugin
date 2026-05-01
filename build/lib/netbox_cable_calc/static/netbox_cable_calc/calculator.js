console.log('calculator.js loaded');

document.addEventListener('DOMContentLoaded', function() {
  console.log('DOMContentLoaded fired');
  
  var siteTree = window.NETBOX_SITE_TREE || [];
  console.log('siteTree:', siteTree.length, 'sites');
  
  var siteSelect = document.getElementById('site_id');
  var locationSelect = document.getElementById('location_id');
  
  if (!siteSelect || !locationSelect) {
    console.error('Elements not found');
    return;
  }
  
  function updateLocations() {
    var siteId = siteSelect.value;
    console.log('updateLocations called:', siteId);
    locationSelect.innerHTML = '<option value="">-- Select Location --</option>';
    
    if (siteId) {
      var site = siteTree.find(function(s) { return s.id == siteId; });
      if (site && site.locations && site.locations.length > 0) {
        console.log('Adding', site.locations.length, 'locations');
        site.locations.forEach(function(loc) {
          var option = document.createElement('option');
          option.value = loc.id;
          option.textContent = loc.name;
          locationSelect.appendChild(option);
        });
      }
    }
    
    // Refresh tom-select if it exists
    if (locationSelect.tomselect) {
      console.log('Refreshing tom-select');
      locationSelect.tomselect.clearOptions();
      locationSelect.tomselect.load(function(callback) {
        var options = [];
        for (var i = 0; i < locationSelect.options.length; i++) {
          options.push({
            value: locationSelect.options[i].value,
            text: locationSelect.options[i].text
          });
        }
        callback(options);
      });
      locationSelect.tomselect.sync();
    }
  }
  
  siteSelect.addEventListener('change', updateLocations);
  console.log('Script ready');
});
