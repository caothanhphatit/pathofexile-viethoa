#!/bin/bash
# Auto-update poe.ninja prices and sync to UAT site.
cd /root/pathofexile-viethoa-v2
/usr/bin/node scripts/boss/fetch-prices.mjs
/usr/bin/rsync -a --delete public/ /var/www/v2.poeviethoa.net/
/usr/bin/chown -R www-data:www-data /var/www/v2.poeviethoa.net/
echo "$(date): Updated prices and synced to UAT."
