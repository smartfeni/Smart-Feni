#!/data/data/com.termux/files/usr/bin/bash

git pull origin main
vercel --prod --token=$VERCEL_TOKEN
