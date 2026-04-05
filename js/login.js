// js/login.js
import { auth } from "../firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const btnLogin = document.getElementById("btn-login");
const errorMsg = document.getElementById("error-msg");

btnLogin.addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
        // Intenta iniciar sesión
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        console.log("Sesión iniciada:", userCredential.user.email);
        
        // Redirige al inventario principal
        window.location.href = "../index.html"; 
    } catch (error) {
        console.error("Error:", error.message);
        errorMsg.style.display = "block"; // Muestra el mensaje de error
    }
});
