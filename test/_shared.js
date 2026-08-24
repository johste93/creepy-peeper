document.addEventListener("DOMContentLoaded", function () {
  var btn = document.getElementById("under");
  var log = document.getElementById("log");
  var n = 0;
  if (btn) btn.addEventListener("click", function () {
    btn.classList.add("hit");
    log.textContent = "click-through OK (" + (++n) + ")";
  });
});
