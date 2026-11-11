document.querySelector('[data-showcase]').addEventListener('change', event => {
  document.body.classList.toggle('showcase', event.target.checked);
});
