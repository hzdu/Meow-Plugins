const fs = require('fs');
let s = fs.readFileSync('css/popup.css', 'utf8');
let cleanS = s.split('/* Custom')[0];
if (cleanS.length < s.length) { cleanS = cleanS.trim(); }

const css = `
/* Flatpickr Usability Enhancements */
.flatpickr-months {
    min-height: 50px;
    align-items: center;
}
.flatpickr-current-month {
    display: flex !important;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 !important;
    height: 100% !important;
    position: relative !important;
    top: 0 !important;
}
.flatpickr-current-month .flatpickr-monthDropdown-months {
    background-color: #f3f4f6;
    border: none;
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 15px !important;
    font-weight: 500;
    outline: none;
    transition: background 0.2s;
    height: 34px;
    line-height: inherit;
    appearance: none;
}
.flatpickr-current-month .flatpickr-monthDropdown-months:hover {
    background-color: #e5e7eb;
}
.flatpickr-current-month .numInputWrapper {
    width: 85px !important;
    background-color: #f3f4f6;
    border-radius: 8px;
    transition: background 0.2s;
    height: 34px;
}
.flatpickr-current-month .numInputWrapper:hover {
    background-color: #e5e7eb;
}
.flatpickr-current-month input.cur-year {
    font-size: 15px !important;
    font-weight: 500;
    padding: 0 30px 0 10px !important;
    text-align: center;
    background: transparent;
    cursor: pointer;
    height: 34px !important;
    box-sizing: border-box;
}
.flatpickr-current-month input.cur-year:focus {
    cursor: text;
}
.flatpickr-current-month .numInputWrapper span {
    opacity: 1 !important; 
    border: none !important;
    background-color: #e5e7eb;
    width: 25px !important;
    display: flex !important;
    align-items: center;
    justify-content: center;
}
.flatpickr-current-month .numInputWrapper span:hover {
    background-color: #d1d5db;
}
.flatpickr-current-month .numInputWrapper span.arrowUp {
    border-radius: 0 8px 0 0;
    height: 50%;
}
.flatpickr-current-month .numInputWrapper span.arrowDown {
    border-radius: 0 0 8px 0;
    height: 50%;
    top: 50%;
}
.flatpickr-current-month .numInputWrapper span::after {
    border-width: 5px !important;
}
.flatpickr-current-month .numInputWrapper span.arrowUp::after {
    border-bottom-color: #4b5563 !important;
    top: auto !important;
}
.flatpickr-current-month .numInputWrapper span.arrowDown::after {
    border-top-color: #4b5563 !important;
    top: auto !important;
}
`;

fs.writeFileSync('css/popup.css', cleanS + '\n' + css, 'utf8');
console.log('Appended clean CSS to popup.css');
