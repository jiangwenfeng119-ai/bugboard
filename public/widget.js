(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var source = new URL(script.src);
  var token = source.searchParams.get("token");
  if (!token) return;
  var endpoint = source.origin + "/api/widget/" + encodeURIComponent(token) + "/bugs";
  var logs = [];
  ["error", "warn"].forEach(function (level) {
    var original = console[level];
    if (!original) return;
    console[level] = function () {
      var text = Array.prototype.slice.call(arguments).map(String).join(" ").slice(0, 300);
      logs.push(level + ": " + text);
      if (logs.length > 20) logs.shift();
      return original.apply(console, arguments);
    };
  });

  var style = document.createElement("style");
  style.textContent =
    ".bbw-btn{position:fixed;right:16px;bottom:16px;z-index:2147483000;border:0;border-radius:999px;padding:10px 14px;background:#1f6feb;color:#fff;font:14px/1.2 sans-serif;cursor:pointer}" +
    ".bbw-layer{position:fixed;inset:0;z-index:2147483001;background:rgba(21,32,51,.5);display:grid;place-items:center;padding:16px}" +
    ".bbw-card{width:min(920px,100%);background:#fff;color:#152033;border-radius:14px;display:grid;grid-template-columns:1fr 260px;overflow:hidden}" +
    ".bbw-card canvas{width:100%;height:min(68vh,640px);background:#101820;touch-action:none;cursor:crosshair}" +
    ".bbw-side{padding:14px;display:grid;gap:8px;align-content:start}" +
    ".bbw-side textarea{width:100%;min-height:90px;font:inherit}" +
    ".bbw-side button{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid #d3dce8;background:#fff;cursor:pointer}" +
    ".bbw-primary{background:#1f6feb!important;color:#fff!important;border-color:#1f6feb!important}" +
    "@media(max-width:800px){.bbw-card{grid-template-columns:1fr}.bbw-card canvas{height:42vh}}";
  document.head.appendChild(style);

  var openButton = document.createElement("button");
  openButton.className = "bbw-btn";
  openButton.type = "button";
  openButton.textContent = "报障";
  openButton.addEventListener("click", open);
  document.documentElement.appendChild(openButton);

  function open() {
    chooseFrame().then(function (blob) {
      if (blob) show(blob);
    }).catch(function () {});
  }

  function chooseFrame() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return pickFile();
    }
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      var video = document.createElement("video");
      video.srcObject = stream;
      return video.play().then(function () {
        var canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext("2d").drawImage(video, 0, 0);
        stream.getTracks().forEach(function (track) { track.stop(); });
        return new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
      });
    }).catch(function () { return pickFile(); });
  }

  function pickFile() {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.capture = "environment";
      input.onchange = function () {
        resolve(input.files && input.files[0] ? input.files[0] : null);
      };
      input.click();
    });
  }

  function show(blob) {
    var url = URL.createObjectURL(blob);
    var layer = document.createElement("div");
    layer.className = "bbw-layer";
    layer.innerHTML =
      '<div class="bbw-card" role="dialog" aria-label="上报问题"><canvas></canvas><div class="bbw-side">' +
      "<strong>圈出问题</strong><p>拖动画圈，旁边写一句。</p>" +
      '<textarea placeholder="哪里不对"></textarea>' +
      '<button type="button" data-act="undo">撤销</button>' +
      '<button type="button" class="bbw-primary" data-act="send">提交</button>' +
      '<button type="button" data-act="close">取消</button><p data-msg></p></div></div>';
    document.body.appendChild(layer);
    var canvas = layer.querySelector("canvas");
    var note = layer.querySelector("textarea");
    var msg = layer.querySelector("[data-msg]");
    var image = new Image();
    var strokes = [];
    var current = null;
    image.onload = paint;
    image.src = url;

    function paint() {
      var rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
      var ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#c62828";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      strokes.concat(current ? [current] : []).forEach(function (stroke) {
        ctx.beginPath();
        stroke.forEach(function (point, index) {
          var x = point.x * canvas.width;
          var y = point.y * canvas.height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
    }

    function point(event) {
      var bounds = canvas.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
        y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
      };
    }
    canvas.addEventListener("pointerdown", function (event) {
      current = [point(event)];
    });
    canvas.addEventListener("pointermove", function (event) {
      if (!current) return;
      current.push(point(event));
      paint();
    });
    canvas.addEventListener("pointerup", function () {
      if (current && current.length > 1) strokes.push(current);
      current = null;
      paint();
    });
    layer.addEventListener("click", function (event) {
      var act = event.target.getAttribute && event.target.getAttribute("data-act");
      if (act === "close") close();
      if (act === "undo") {
        strokes.pop();
        paint();
      }
      if (act === "send") send();
    });

    function close() {
      URL.revokeObjectURL(url);
      layer.remove();
    }

    function send() {
      var exportCanvas = document.createElement("canvas");
      exportCanvas.width = image.naturalWidth || canvas.width;
      exportCanvas.height = image.naturalHeight || canvas.height;
      var ctx = exportCanvas.getContext("2d");
      ctx.drawImage(image, 0, 0, exportCanvas.width, exportCanvas.height);
      ctx.strokeStyle = "#c62828";
      ctx.lineWidth = Math.max(3, exportCanvas.width / 180);
      strokes.forEach(function (stroke) {
        ctx.beginPath();
        stroke.forEach(function (p, index) {
          var x = p.x * exportCanvas.width;
          var y = p.y * exportCanvas.height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
      exportCanvas.toBlob(function (png) {
        var form = new FormData();
        form.set("note", note.value || "");
        form.set("pageUrl", location.href);
        form.set("viewport", window.innerWidth + "x" + window.innerHeight);
        form.set("userAgent", navigator.userAgent);
        form.set("console", logs.join("\n"));
        if (png) form.set("file", new File([png], "圈选.png", { type: "image/png" }));
        fetch(endpoint, { method: "POST", body: form })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) throw new Error(result.data.error || "上报失败");
            close();
          })
          .catch(function (error) {
            msg.textContent = error.message || "上报失败";
          });
      }, "image/png");
    }
  }
})();
