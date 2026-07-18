import { spawn } from 'child_process';
import fs from 'fs';
const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
(async () => {
  const title = await new Promise((resolve, reject) => {
    const p = spawn('yt-dlp', ['--no-playlist','--skip-download','--print','title', url], {stdio:['ignore','pipe','pipe']});
    let out=''; let err='';
    p.stdout.on('data', d => out += d.toString());
    p.stderr.on('data', d => err += d.toString());
    p.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err || out || 'title failed')));
  });
  console.log('TITLE', title);
  const outputFile = '/tmp/' + Date.now() + '-' + title.replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g, ' ').trim() + '.mp4';
  console.log('OUTPUT', outputFile);
  const p = spawn('yt-dlp', ['--no-playlist','--format','best[ext=mp4]/bestvideo[height<=?1080]+bestaudio/best','--output', outputFile, url], {stdio:['ignore','pipe','pipe']});
  let stdout=''; let stderr='';
  p.stdout.on('data', d => stdout += d.toString());
  p.stderr.on('data', d => stderr += d.toString());
  p.on('close', code => {
    console.log('EXIT', code);
    console.log('STDOUT', stdout.slice(-1000));
    console.log('STDERR', stderr.slice(-1000));
    console.log('EXISTS', fs.existsSync(outputFile), outputFile);
    if (fs.existsSync(outputFile)) console.log('SIZE', fs.statSync(outputFile).size);
  });
})();
