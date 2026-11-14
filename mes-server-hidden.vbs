' Launches the DHOWN MES backend server with no visible window at logon.
Dim sh : Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend"
sh.Run "cmd /c node server.js >> ""D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend\mes-server.log"" 2>&1", 0, False
