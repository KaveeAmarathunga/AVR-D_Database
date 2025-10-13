@echo off
REM ===============================
REM Node.js Project Startup Script
REM ===============================

REM Change to your project directory
cd /d "C:\Users\Ranna 2MW\Desktop\Database\RannaDatabase-master\influx-node\opcua-influx\opcua-ns4-subscriber"

REM Start Node.js main file
:restart
echo Starting Node.js project...
node main.js
echo Node.js project stopped. Restarting in 5 seconds...
timeout /t 5
goto restart
