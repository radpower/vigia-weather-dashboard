# Vigia — painel meteorológico

Aplicação web instalável para acompanhar avisos meteorológicos, previsão horária, notícias e informação de preparação para emergências.

## Funcionalidades

- Avisos do IPMA e previsão por modelo do Open-Meteo.
- Mapa interativo Windy e previsão horária.
- Consulta de interrupções programadas da E-REDES.
- Cache offline e plano pessoal guardado no dispositivo.
- Notícias de fontes portuguesas e alerta sonoro com a página ativa.

## Executar

Serve esta pasta com um servidor HTTP estático. Para instalação e funcionamento offline fora de localhost, utiliza HTTPS.

## Limitações

A previsão e os avisos são dados de fontes externas, sujeitos a falhas e atualização em intervalos próprios. As interrupções programadas não mostram avarias não programadas. O alerta sonoro não funciona com a página fechada. O projeto não substitui os avisos oficiais.

A versão pública utiliza coordenadas de referência da cidade da Figueira da Foz. As preferências e o plano pessoal são locais ao navegador.
