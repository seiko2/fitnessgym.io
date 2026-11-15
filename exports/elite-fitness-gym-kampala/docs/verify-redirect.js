const query = new URLSearchParams(location.search);
query.set('verify', '1');
location.replace('../index.html?' + query.toString());
