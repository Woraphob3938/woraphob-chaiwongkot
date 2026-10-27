# The FitConnect API for a container host such as Railway (set the service's root directory to backend/).
FROM php:8.2-apache

RUN docker-php-ext-install pdo_mysql \
 && a2enmod rewrite headers \
 # .htaccess carries the routing and the rules that keep src/, tests/ and uploads/ private.
 && sed -i 's/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf \
 # Certificates may be 8 MB; PHP's default limit is 2 MB.
 && printf 'upload_max_filesize=10M\npost_max_size=12M\n' > /usr/local/etc/php/conf.d/uploads.ini

COPY . /var/www/html/

# The host picks the port, and a mounted uploads volume arrives owned by root.
# The loop is the scheduler: once a minute it closes bookings whose payment
# window ran out, then sends reminders and queued e-mails. Only its errors reach
# the container log.
# ponytail: one loop in the web container; move to a cron service if the API ever runs more than one replica.
CMD ["sh", "-c", "sed -i \"s/80/${PORT:-80}/\" /etc/apache2/ports.conf /etc/apache2/sites-available/000-default.conf && chown -R www-data:www-data /var/www/html/uploads && (while true; do php scripts/expire-bookings.php >/dev/null; php scripts/process-notifications.php >/dev/null; sleep 60; done &) && exec apache2-foreground"]
