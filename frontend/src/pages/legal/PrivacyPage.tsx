export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white">
        Política de Privacidad
      </h1>
      <p className="mt-2 text-sm text-surface-500">Última actualización: abril de 2026</p>

      <div className="prose prose-surface dark:prose-invert mt-8 max-w-none text-sm leading-7">

        <h2>1. Responsable del Tratamiento</h2>
        <p>
          Nexo Fitness (en adelante "nosotros" o "la Plataforma") es responsable del tratamiento
          de los datos personales que nos proporcionas al usar nuestros servicios.
        </p>

        <h2>2. Datos que Recopilamos</h2>
        <h3>Datos que nos proporcionas directamente:</h3>
        <ul>
          <li>Nombre, apellido, correo electrónico y teléfono al registrarte.</li>
          <li>Datos del gimnasio: nombre, dirección, ciudad, país.</li>
          <li>Información de pago (procesada por terceros — no almacenamos datos de tarjetas).</li>
          <li>Datos de los miembros de tu gimnasio que ingreses a la Plataforma.</li>
        </ul>

        <h3>Datos recopilados automáticamente:</h3>
        <ul>
          <li>Dirección IP y user agent del navegador.</li>
          <li>Registros de acceso y uso de la Plataforma (logs del servidor).</li>
          <li>Cookies de sesión necesarias para el funcionamiento del servicio.</li>
        </ul>

        <h2>3. Finalidad del Tratamiento</h2>
        <p>Usamos tus datos para:</p>
        <ul>
          <li>Proveer y mejorar el servicio de Nexo Fitness.</li>
          <li>Gestionar tu suscripción y procesar pagos.</li>
          <li>Enviarte comunicaciones transaccionales (confirmaciones, facturas, avisos de servicio).</li>
          <li>Enviarte comunicaciones de marketing cuando hayas dado tu consentimiento expreso.</li>
          <li>Cumplir obligaciones legales y resolver disputas.</li>
        </ul>

        <h2>4. Base Legal del Tratamiento</h2>
        <ul>
          <li><strong>Ejecución del contrato:</strong> para proveer el servicio contratado.</li>
          <li><strong>Interés legítimo:</strong> para mejorar la Plataforma y prevenir fraudes.</li>
          <li><strong>Consentimiento:</strong> para comunicaciones de marketing.</li>
          <li><strong>Obligación legal:</strong> cuando la ley nos exija conservar ciertos datos.</li>
        </ul>

        <h2>5. Compartición de Datos con Terceros</h2>
        <p>No vendemos tus datos. Podemos compartirlos con:</p>
        <ul>
          <li>
            <strong>Procesadores de pago:</strong> Stripe, MercadoPago, Fintoc — para procesar
            transacciones.
          </li>
          <li>
            <strong>Proveedor de email:</strong> SendGrid — para enviar correos transaccionales.
          </li>
          <li>
            <strong>Monitoreo de errores:</strong> Sentry — para detectar y corregir problemas técnicos.
          </li>
          <li>
            <strong>Infraestructura:</strong> proveedor de hosting y base de datos en la nube.
          </li>
        </ul>
        <p>
          Todos los terceros están obligados contractualmente a tratar los datos conforme a esta
          política y a las leyes aplicables.
        </p>

        <h2>6. Retención de Datos</h2>
        <p>
          Conservamos tus datos mientras tu cuenta esté activa. Al cancelar la suscripción, los
          datos se retienen por 90 días para posibilitar la reactivación y luego se eliminan
          permanentemente, salvo obligación legal que exija mayor plazo.
        </p>

        <h2>7. Datos de los Miembros de tu Gimnasio</h2>
        <p>
          Como cliente de Nexo Fitness (gimnasio), eres el responsable del tratamiento de los datos
          personales de tus miembros que ingresas a la Plataforma. Nosotros actuamos como encargado
          del tratamiento. Te recomendamos informar a tus miembros de esta práctica mediante tu
          propia política de privacidad.
        </p>

        <h2>8. Tus Derechos</h2>
        <p>Tienes derecho a:</p>
        <ul>
          <li><strong>Acceso:</strong> solicitar una copia de los datos que tenemos sobre ti.</li>
          <li><strong>Rectificación:</strong> corregir datos inexactos.</li>
          <li><strong>Eliminación:</strong> solicitar la eliminación de tus datos.</li>
          <li><strong>Portabilidad:</strong> recibir tus datos en formato exportable (CSV/Excel).</li>
          <li><strong>Oposición:</strong> oponerte al tratamiento para fines de marketing.</li>
        </ul>
        <p>
          Para ejercer estos derechos, escríbenos a{' '}
          <a href="mailto:privacidad@nexofitness.com" className="text-brand-600 hover:underline dark:text-brand-400">
            privacidad@nexofitness.com
          </a>
          . Responderemos en un plazo máximo de 30 días.
        </p>

        <h2>9. Seguridad</h2>
        <p>
          Implementamos medidas técnicas y organizativas apropiadas para proteger tus datos:
          cifrado TLS en tránsito, cifrado de contraseñas con bcrypt, acceso restringido por
          roles, y monitoreo continuo de seguridad. Sin embargo, ningún sistema es 100% seguro.
        </p>

        <h2>10. Cookies</h2>
        <p>
          Usamos exclusivamente cookies de sesión estrictamente necesarias para el funcionamiento
          del servicio. No usamos cookies de rastreo ni publicidad de terceros.
        </p>

        <h2>11. Transferencias Internacionales</h2>
        <p>
          Algunos de nuestros proveedores pueden estar ubicados fuera de Chile. En esos casos,
          garantizamos que el tratamiento se realiza conforme a estándares equivalentes a los
          exigidos por la ley chilena de protección de datos (Ley 19.628 y sus modificaciones).
        </p>

        <h2>12. Cambios a esta Política</h2>
        <p>
          Podemos actualizar esta política periódicamente. Notificaremos cambios sustanciales por
          email. La fecha de última actualización está indicada al inicio del documento.
        </p>

        <h2>13. Contacto</h2>
        <p>
          Para consultas sobre privacidad, escríbenos a{' '}
          <a href="mailto:privacidad@nexofitness.com" className="text-brand-600 hover:underline dark:text-brand-400">
            privacidad@nexofitness.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
