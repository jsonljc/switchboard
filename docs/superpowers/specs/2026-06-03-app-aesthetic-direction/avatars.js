// Switchboard agent pixel sprites — tiny self-hydrating renderer.
// Usage: put <span data-sb-avatar="alex"></span> inside any sized box, OR call
// sbAvatar("riley") to get an SVG string. SVG fills its wrapper (width/height 100%).
(function(){
  var DATA = {"alex":{"pal":{"K":"#1a1108","H":"#5a3418","E":"#7a4a26","S":"#f5c79a","D":"#cd8a5a","G":"#dceeff","M":"#2a1408","C":"#dc8474","B":"#2d4a78","L":"#4a6c98","W":"#f1e7ce","T":"#c0533c","R":"#1a1108","N":"#bfb29a","Z":"#7c6a48","Y":"#f3d24e","P":"#ffffff"},"grid":["........................","........................","........KKKKKKKK........",".......KHHHHHHHHK.......","......KHHHHHHHHHHK......",".....KHHEHHHHHHEHHK.....",".....KHHHHHHHHHHHHK.....",".....KHSSSSSSSSSSHK.....","...KK.KSSSSSSSSSS.KK....","..KRRK.KSGGSSSGGSK.KRRK.","..KRRK.KSGMGSGMGSK.KRRK.","..KRRK.KSGGSSSGGSK.KRRK.","...KK.KSCSSSSSSCSK.KK...","......KSSSSMMMMSSK.K....","......KSSSSSSSSSSK.K....",".......KSSSSSSSSK..N....","........KSSSSSSK........","....KKBBBBWWWWBBBBKK....","...KBBBBBLWTTWLBBBBBK...","..KBBBBBBBWTTWBBBBBBBK..",".KBBBBBBBLWTTWLBBBBBBBK.","KBBBBBBBBBWTTWBBBBBBBBBK","KBBBBBBBBBBWTWBBBBBBBBBK","KBBBBBBBBBBBBBBBBBBBBBBK"]},"riley":{"pal":{"K":"#1a1108","H":"#3a1e10","E":"#6a3018","S":"#f5c79a","D":"#cd8a5a","G":"#e6f2ff","M":"#1a0c06","C":"#dc7a6a","B":"#9d8ac8","L":"#bba6e0","W":"#f5ebd6","T":"#f0d885","Z":"#7c6a48","Y":"#f1c34a","P":"#ffffff","X":"#3a8a5a","Q":"#c0533c"},"grid":["........................","........KKKKKKKK........",".......KHHHHHHHHK.......","......KHHEHHHHEHHK......",".....KHHHHHHHHHHHHK.....","....KHHHHHHHHHHHHHHK....","...KHHHSSSSSSSSSSHHHK...","..KHHHSSSSSSSSSSSSHHHK..","..KHHSSSSSSSSSSSSSSHHK..","..HHKKGGGGSSSSGGGGKKHH..","..HHKGGMMGSSSSGMMGGKHH..","..HHKGGMMGSSSSGMMGGKHH..","..HHKKGGGGSSSSGGGGKKHH..","..HHKSCSSSSCCSSCSKHH....","...HHKSSSSSSSSSSSSKHH...","...HHHKSSSSSSSSSSKHHH...","....HHKSSSSSSSSKHH......","....KKBBBBBWWWWBBBBKK...","...KBBLBBBBKTKBBBBLBBK..","..KBBBBBBLBBBBBLBBBBBBK.",".KBBBBLBBBBBBBBBBBLBBBK.","KBLBBBBBBBLBBBLBBBBBBBLK","KBBBBBBBBBBBBBBBBBBBBBBK","KBBBBBBBBBBBBBBBBBBBBBBK"]},"mira":{"pal":{"K":"#1a1108","H":"#241433","E":"#3c2456","S":"#f5c79a","D":"#cd8a5a","G":"#efe7ff","M":"#1a0c06","C":"#d98fb0","B":"#7a5cc0","L":"#9b80d8","W":"#f5ebd6","T":"#e7b8e0","Z":"#7c6a48","Y":"#f1c34a","P":"#ffffff","X":"#3a8a5a","Q":"#c0533c"},"grid":["........................","........KKKKKKKK........",".......KHHHHHHHHK.......","......KHHEHHHHEHHK......",".....KHHHHHHHHHHHHK.....","....KHHHHHHHHHHHHHHK....","...KHHHSSSSSSSSSSHHHK...","..KHHHSSSSSSSSSSSSHHHK..","..KHHSSSSSSSSSSSSSSHHK..","..HHKKGGGGSSSSGGGGKKHH..","..HHKGGMMGSSSSGMMGGKHH..","..HHKGGMMGSSSSGMMGGKHH..","..HHKKGGGGSSSSGGGGKKHH..","..HHKSCSSSSCCSSCSKHH....","...HHKSSSSSSSSSSSSKHH...","...HHHKSSSSSSSSSSKHHH...","....HHKSSSSSSSSKHH......","....KKBBBBBWWWWBBBBKK...","...KBBLBBBBKTKBBBBLBBK..","..KBBBBBBLBBBBBLBBBBBBK.",".KBBBBLBBBBBBBBBBBLBBBK.","KBLBBBBBBBLBBBLBBBBBBBLK","KBBBBBBBBBBBBBBBBBBBBBBK","KBBBBBBBBBBBBBBBBBBBBBBK"]}};
  function svg(name){
    var d = DATA[name]; if(!d) return "";
    var r = "";
    for(var y=0;y<24;y++){ var row=d.grid[y]||"";
      for(var x=0;x<24;x++){ var c=row[x];
        if(!c||c==="."||c===" ") continue;
        var col=d.pal[c]; if(!col) continue;
        r+='<rect x="'+x+'" y="'+y+'" width="1.02" height="1.02" fill="'+col+'"/>';
      } }
    return '<svg viewBox="0 0 24 24" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="width:100%;height:100%;display:block">'+r+'</svg>';
  }
  window.sbAvatar = svg;
  function hydrate(){ var els=document.querySelectorAll("[data-sb-avatar]");
    for(var i=0;i<els.length;i++){ els[i].innerHTML = svg(els[i].getAttribute("data-sb-avatar")); } }
  if(document.readyState!=="loading") hydrate();
  else document.addEventListener("DOMContentLoaded", hydrate);
})();