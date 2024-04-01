import './assets/main.css'
import Tracker from 'tc-tracker'
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(Tracker, {
  dns: 'http://localhost:4001/log'
})

app.mount('#app')
