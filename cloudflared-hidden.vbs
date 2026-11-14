' Runs the Cloudflare tunnel (mes.dhownhosiery.com -> localhost:4000) hidden at logon.
Dim sh : Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Program Files (x86)\cloudflared\cloudflared.exe"" tunnel run dhown-mes", 0, False
