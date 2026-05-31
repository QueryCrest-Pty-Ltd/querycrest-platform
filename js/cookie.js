function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = name + "=" + value + "; path=/; expires=" + date.toUTCString();
  }

  function getCookie(name) {
    return document.cookie
      .split("; ")
      .find(row => row.startsWith(name + "="))
      ?.split("=")[1];
  }

  const overlay = document.getElementById("qc-cookie-overlay");
  const acceptBtn = document.getElementById("qc-accept-btn");

  if (getCookie("qc_cookie_consent") === "true") {
    overlay.style.display = "none";
  }

  acceptBtn.addEventListener("click", () => {
    setCookie("qc_cookie_consent", "true", 365);
    overlay.style.display = "none";
  });