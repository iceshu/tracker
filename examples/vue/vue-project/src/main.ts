import './assets/main.css'
import Tracker from 'tracker'
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(Tracker, {
  dns: 'https://example.com'
})

app.mount('#app')
