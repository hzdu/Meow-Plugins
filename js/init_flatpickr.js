// Initialize Flatpickr for countdown date input
let cdDatePicker;
document.addEventListener('DOMContentLoaded', () => {
    const cdDateInputElement = document.getElementById('cd-date-input');
    
    if (typeof flatpickr !== 'undefined' && cdDateInputElement) {
        const localeStr = (window.meowI18n && window.meowI18n.lang === 'zh-TW') ? 'zh_tw' : (window.meowI18n && window.meowI18n.lang === 'en' ? 'en' : 'zh');
        
        cdDatePicker = flatpickr(cdDateInputElement, {
            locale: localeStr,
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'Y/m/d',
            disableMobile: true,
            onReady: function(selectedDates, dateStr, instance) {
                const todayBtn = document.createElement("button");
                todayBtn.className = "flatpickr-today-btn";
                const todayText = (window.meowI18n && window.meowI18n.t && window.meowI18n.t('today')) || "今天";
                todayBtn.innerHTML = todayText;
                todayBtn.type = "button";
                todayBtn.addEventListener("click", function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const now = new Date();
                    instance.setDate(now, true);
                    instance.jumpToDate(now);
                });
                const currentMonthContainer = instance.calendarContainer.querySelector('.flatpickr-current-month');
                if (currentMonthContainer) {
                    currentMonthContainer.insertBefore(todayBtn, currentMonthContainer.firstChild);
                }
            },
            onChange: function(selectedDates, dateStr, instance) {
                // Ensure value is set in Y-m-d for popup.js logic
                cdDateInputElement.value = dateStr;
                cdDateInputElement.setAttribute('data-display-date', dateStr.replace(/-/g, '/'));
                cdDateInputElement.dispatchEvent(new Event('change'));
            }
        });

        // Listen for language changes in i18n
        if (window.meowI18n) {
            const originalSetLang = window.meowI18n.setLang.bind(window.meowI18n);
            window.meowI18n.setLang = async function(lang) {
                await originalSetLang(lang);
                if (cdDatePicker) {
                    const newLocaleStr = (lang === 'zh-TW') ? 'zh_tw' : (lang === 'en' ? 'en' : 'zh');
                    cdDatePicker.set('locale', newLocaleStr);
                }
            };
        }
    }
});
