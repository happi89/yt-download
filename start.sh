#!/bin/sh
if [ -n "$YT_COOKIES_BASE64" ]; then
  echo "$YT_COOKIES_BASE64" | base64 -d > /app/cookies.txt
  echo "Cookies file written."
else
  echo "No YT_COOKIES_BASE64 set — proceeding without cookies."
fi

exec npm start